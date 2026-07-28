/**
 * Stripe, over plain fetch.
 *
 * Only three things are needed — open a Checkout Session, verify a webhook signature, read back
 * the invoice Checkout generated — and all three are a few lines against the REST API. Pulling
 * the Stripe SDK into a Worker bundle to do that is not worth it, the same way OpenRouter is
 * called by hand in `functions/api/ask.ts`.
 */

import type { Env } from './env';
import { PRODUCT_TAX_CODE } from './env';
import { timingSafeEqual } from './http';

/**
 * Pinned so a Stripe API upgrade can never change the shape of what arrives here without the
 * version in this file changing first.
 */
const API_VERSION = '2025-09-30.clover';

/** Signatures older than this are rejected, which is what stops a captured webhook being replayed. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

async function stripe<T>(env: Env, path: string, form?: Record<string, string>): Promise<T> {
	const response = await fetch(`https://api.stripe.com/v1/${path}`, {
		method: form ? 'POST' : 'GET',
		headers: {
			authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
			'stripe-version': API_VERSION,
			...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
		},
		...(form ? { body: new URLSearchParams(form).toString() } : {}),
	});

	const payload = (await response.json()) as T & { error?: { message?: string } };
	if (!response.ok) {
		throw new Error(payload.error?.message ?? `Stripe returned HTTP ${response.status}.`);
	}
	return payload;
}

// ---------------------------------------------------------------- checkout

export interface CheckoutSession {
	id: string;
	url: string;
}

/**
 * Opens a hosted Checkout page for one purchase.
 *
 * The price is built inline rather than referencing a Price object in the dashboard, so there is
 * nothing to create by hand in Stripe before the first sale — changing what $5 buys is a change
 * to `server/env.ts` and nothing else.
 *
 * There is deliberately no `invoice_creation` here. This account runs Stripe Managed Payments,
 * where Stripe is the merchant of record and owns everything after the sale — the invoice, the
 * tax on it, and its own confirmation email. Sending `invoice_creation` alongside it is rejected
 * outright ("Unsupported parameter"), because it would be asking to do a job Stripe has taken.
 *
 * An invoice is still produced; it is just Stripe's to make. The webhook reads it back off the
 * session when it is there, and the receipt email links to it — see `sendReceipt`, which treats a
 * missing one as normal rather than as a failure.
 *
 * If Managed Payments is ever turned off (dashboard → Settings → Payments, or
 * `managed_payments[enabled]: 'false'` on this call), add `'invoice_creation[enabled]': 'true'`
 * back and the invoice becomes ours to create again.
 */
export async function createCheckoutSession(
	env: Env,
	options: {
		userId: string;
		email: string;
		messages: number;
		amountCents: number;
		successUrl: string;
		cancelUrl: string;
	},
): Promise<CheckoutSession> {
	return stripe<CheckoutSession>(env, 'checkout/sessions', {
		mode: 'payment',
		'line_items[0][quantity]': '1',
		'line_items[0][price_data][currency]': 'usd',
		'line_items[0][price_data][unit_amount]': String(options.amountCents),
		'line_items[0][price_data][product_data][name]': `${options.messages} messages`,
		'line_items[0][price_data][product_data][description]':
			`${options.messages} questions answered by Jamie at the Church of Jamie.`,
		'line_items[0][price_data][product_data][tax_code]': PRODUCT_TAX_CODE,
		customer_email: options.email,
		// Both are read back in the webhook; `client_reference_id` also shows in the dashboard.
		client_reference_id: options.userId,
		'metadata[user_id]': options.userId,
		'metadata[messages]': String(options.messages),
		success_url: options.successUrl,
		cancel_url: options.cancelUrl,
	});
}

// ---------------------------------------------------------------- invoices

export interface Invoice {
	number: string | null;
	hosted_invoice_url: string | null;
	invoice_pdf: string | null;
}

export function fetchInvoice(env: Env, invoiceId: string): Promise<Invoice> {
	return stripe<Invoice>(env, `invoices/${invoiceId}`);
}

// ---------------------------------------------------------------- webhooks

export interface StripeEvent {
	id: string;
	type: string;
	/** Seconds since the epoch, from Stripe's clock — what the receipt is dated by. */
	created: number;
	data: { object: Record<string, unknown> };
}

/**
 * Verifies the `Stripe-Signature` header against the raw request body and returns the event.
 *
 * The body must be the exact bytes Stripe sent — re-serialising parsed JSON changes the payload
 * and the signature will not match, so the caller reads it as text and hands it over untouched.
 */
export async function verifyWebhook(
	env: Env,
	rawBody: string,
	signatureHeader: string | null,
): Promise<StripeEvent> {
	if (!signatureHeader) throw new Error('Missing Stripe-Signature header.');

	// `t=1699999999,v1=abc...,v1=def...` — more than one v1 while a secret is being rotated.
	let timestamp = '';
	const signatures: string[] = [];
	for (const part of signatureHeader.split(',')) {
		const [key, value] = part.split('=', 2);
		if (key?.trim() === 't') timestamp = value?.trim() ?? '';
		else if (key?.trim() === 'v1' && value) signatures.push(value.trim());
	}

	if (!timestamp || signatures.length === 0) throw new Error('Malformed Stripe-Signature header.');

	const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
	if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
		throw new Error('Stripe signature timestamp is outside the tolerance window.');
	}

	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
	const expected = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

	if (!signatures.some((candidate) => timingSafeEqual(expected, candidate))) {
		throw new Error('Stripe signature does not match.');
	}

	return JSON.parse(rawBody) as StripeEvent;
}
