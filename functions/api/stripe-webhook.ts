/**
 * POST /api/stripe-webhook — the only place a balance goes up.
 *
 * Stripe signs every callback; an unsigned or stale one is rejected before anything is read out
 * of it. Stripe also redelivers, sometimes for days, so the event id is written into `purchases`
 * as a primary key first and the messages are granted only if that insert was the one that won.
 * A redelivery therefore does nothing at all.
 *
 * Anything that goes wrong *after* the grant — a receipt that would not send, say — still answers
 * 200. Asking Stripe to retry would only re-run a grant that has already happened.
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import { grantMessages } from '../../server/accounts';
import type { Env } from '../../server/env';
import { MESSAGES_PER_PURCHASE, required } from '../../server/env';
import { receiptEmail, sendEmail } from '../../server/email';
import { fail, json, now } from '../../server/http';
import { fetchInvoice, verifyWebhook } from '../../server/stripe';

/** A real Stripe event is a few kilobytes; anything past this is not one. */
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/** The Checkout Session as it arrives inside `checkout.session.completed`. */
interface CompletedSession {
	id?: string;
	payment_status?: string;
	amount_total?: number;
	invoice?: string | null;
	client_reference_id?: string | null;
	metadata?: { user_id?: string; messages?: string } | null;
	customer_details?: { email?: string | null } | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	try {
		required(env, 'DB', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET');
	} catch (error: unknown) {
		return fail(error instanceof Error ? error.message : 'Not configured.', 500);
	}

	// This endpoint is public by necessity — Stripe has to be able to reach it — so bound the work
	// an unsigned caller can cause before the HMAC is computed over it. Real events are kilobytes.
	if (Number(request.headers.get('content-length') ?? 0) > MAX_WEBHOOK_BODY_BYTES) {
		return fail('Payload too large.', 413);
	}

	// Must be the exact bytes Stripe signed — parsing and re-serialising would break the HMAC.
	const rawBody = await request.text();
	if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) return fail('Payload too large.', 413);

	let event;
	try {
		event = await verifyWebhook(env, rawBody, request.headers.get('stripe-signature'));
	} catch (error: unknown) {
		return fail(error instanceof Error ? error.message : 'Bad signature.', 400);
	}

	if (event.type !== 'checkout.session.completed') return json({ received: true });

	const session = event.data.object as CompletedSession;

	// `complete` with an unpaid status happens on delayed payment methods; wait for the paid event.
	if (session.payment_status !== 'paid') return json({ received: true });

	const userId = session.metadata?.user_id ?? session.client_reference_id ?? null;
	if (!userId) return json({ received: true, note: 'No user on the session.' });

	const messages = Number(session.metadata?.messages) || MESSAGES_PER_PURCHASE;
	const amountCents = session.amount_total ?? 0;

	// The idempotency gate. Losing this insert means a redelivery — stop here.
	const claim = await env.DB.prepare(
		`INSERT INTO purchases (stripe_event_id, user_id, amount_cents, messages, created_at)
		 VALUES (?, ?, ?, ?, ?) ON CONFLICT(stripe_event_id) DO NOTHING`,
	)
		.bind(event.id, userId, amountCents, messages, now())
		.run();

	if ((claim.meta.changes ?? 0) === 0) return json({ received: true, note: 'Already applied.' });

	const granted = await grantMessages(env, userId, messages);
	if (!granted) {
		// The account was deleted between paying and this callback. The ledger row stays as the
		// record of the payment; there is nobody left to credit.
		return json({ received: true, note: 'Account no longer exists.' });
	}

	try {
		await sendReceipt(env, {
			userId,
			eventId: event.id,
			eventCreated: event.created,
			messages,
			amountCents,
			invoiceId: session.invoice ?? null,
			fallbackEmail: session.customer_details?.email ?? null,
		});
	} catch (error: unknown) {
		// Logged for the tail, never surfaced: the messages are already on the account.
		console.error('Receipt email failed', error);
	}

	return json({ received: true });
};

async function sendReceipt(
	env: Env,
	details: {
		userId: string;
		eventId: string;
		eventCreated: number;
		messages: number;
		amountCents: number;
		invoiceId: string | null;
		fallbackEmail: string | null;
	},
): Promise<void> {
	const account = await env.DB.prepare('SELECT email, messages_remaining FROM users WHERE id = ?')
		.bind(details.userId)
		.first<{ email: string; messages_remaining: number }>();

	const to = account?.email ?? details.fallbackEmail;
	if (!to) return;

	// Under Managed Payments the invoice is Stripe's to create, so it may be absent from the
	// session, arrive later than this callback, or not be readable with this key at all. None of
	// that is a reason to withhold a receipt for money that has already changed hands — the
	// invoice number and link are decoration on it, so they are best-effort and nothing more.
	let invoiceNumber: string | null = null;
	let invoiceUrl: string | null = null;
	if (details.invoiceId) {
		try {
			const invoice = await fetchInvoice(env, details.invoiceId);
			invoiceNumber = invoice.number;
			invoiceUrl = invoice.hosted_invoice_url ?? invoice.invoice_pdf;
			if (invoiceNumber) {
				await env.DB.prepare('UPDATE purchases SET invoice_number = ? WHERE stripe_event_id = ?')
					.bind(invoiceNumber, details.eventId)
					.run();
			}
		} catch (error: unknown) {
			console.error('Could not read the invoice; sending the receipt without it', error);
		}
	}

	const { subject, text } = receiptEmail({
		messages: details.messages,
		amountCents: details.amountCents,
		invoiceNumber,
		invoiceUrl,
		balance: account?.messages_remaining ?? details.messages,
		date: new Date(details.eventCreated * 1000).toISOString().slice(0, 10),
	});

	await sendEmail(env, { to, subject, text });
}
