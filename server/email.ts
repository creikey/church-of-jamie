/**
 * Outgoing mail, through Cloudflare Email Service.
 *
 * The REST API is used rather than the `send_email` Worker binding for two reasons: Pages
 * Functions do not support that binding at all, and the binding can only reach addresses already
 * verified as Email Routing destinations — useless for mailing a sign-in code to someone who has
 * just typed their address in for the first time. A token and a fetch reach any recipient.
 *
 * Everything here is `text/plain` on purpose. There are exactly two messages — a sign-in code and
 * a receipt — and both are things people forward to an accountant or keep for their records, so
 * they should read the same in any client and archive as plain text. Omitting `html` entirely is
 * what makes Cloudflare send a plain-text-only message.
 */

import type { Env } from './env';
import { required } from './env';

interface Message {
	to: string;
	subject: string;
	text: string;
	/** Set on the receipt so a reply reaches a human rather than the sending address. */
	replyTo?: string;
}

/** An address in the shape the API wants it, so a display name survives the trip. */
interface Address {
	address: string;
	name?: string;
}

/**
 * Accepts either `jamie@example.com` or `Church of Jamie <jamie@example.com>`, so `EMAIL_FROM`
 * can be written whichever way comes naturally and neither one silently sends as the literal
 * string.
 */
export function parseAddress(raw: string): Address {
	const angled = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(raw);
	if (!angled) return { address: raw.trim() };

	// Display names are often quoted in the header form; the API wants them bare.
	const name = angled[1].replace(/^"(.*)"$/, '$1').trim();
	return name ? { address: angled[2], name } : { address: angled[2] };
}

interface SendResponse {
	success?: boolean;
	errors?: { code?: number; message?: string }[];
	result?: { delivered?: string[]; permanent_bounces?: string[]; queued?: string[] };
}

export async function sendEmail(env: Env, message: Message): Promise<void> {
	required(env, 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_TOKEN', 'EMAIL_FROM');

	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${env.CLOUDFLARE_EMAIL_TOKEN}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				from: parseAddress(env.EMAIL_FROM),
				to: message.to,
				subject: message.subject,
				text: message.text,
				...(message.replyTo ? { reply_to: parseAddress(message.replyTo) } : {}),
			}),
		},
	);

	const payload = (await response.json().catch(() => ({}))) as SendResponse;
	if (response.ok && payload.success) return;

	throw new Error(explain(response.status, payload));
}

/**
 * Turns the API's error into something that names the fix. These are the three that actually
 * happen, and each one is a specific setup step that was missed rather than a transient fault —
 * saying so beats echoing `email.sending.error.*` at whoever is reading the logs.
 */
function explain(status: number, payload: SendResponse): string {
	const error = payload.errors?.[0];
	const detail = error?.message ?? `HTTP ${status}`;

	if (error?.code === 1000) {
		return `Could not send the email: the sending domain is not verified. Onboard it under Cloudflare dashboard → Compute → Email Service → Email Sending, and make sure EMAIL_FROM is an address on that domain. (${detail})`;
	}
	if (status === 401 || status === 403) {
		return `Could not send the email: CLOUDFLARE_EMAIL_TOKEN was rejected. It needs the account-level "Email Sending: Edit" permission. (${detail})`;
	}
	if (status === 429) {
		return `Could not send the email: Cloudflare is rate limiting this account's sending. New accounts start with a low daily quota that rises with use. (${detail})`;
	}
	return `Could not send the email (HTTP ${status}): ${detail}`;
}

export function signInEmail(code: string): { subject: string; text: string } {
	return {
		subject: `${code} is your sign-in code`,
		text: [
			`Your sign-in code for the Church of Jamie is:`,
			``,
			`    ${code}`,
			``,
			`It is good for ten minutes. If you did not ask for it, nothing has happened to`,
			`your account and you can ignore this message.`,
			``,
		].join('\n'),
	};
}

export function receiptEmail(details: {
	messages: number;
	amountCents: number;
	invoiceNumber: string | null;
	invoiceUrl: string | null;
	balance: number;
	/** ISO date, formatted by the caller so this stays a pure function of its input. */
	date: string;
}): { subject: string; text: string } {
	const amount = `$${(details.amountCents / 100).toFixed(2)} USD`;

	const lines = [
		`Thank you. Your payment went through.`,
		``,
		`Date:        ${details.date}`,
		`Description: ${details.messages} messages`,
		`Amount:      ${amount}`,
	];

	if (details.invoiceNumber) lines.push(`Invoice:     ${details.invoiceNumber}`);
	lines.push(``, `You now have ${details.balance} messages remaining.`);

	if (details.invoiceUrl) {
		lines.push(``, `The itemised invoice, with a PDF you can download, is here:`, details.invoiceUrl);
	}

	lines.push(``, `The Church of Jamie`, ``);

	return { subject: `Receipt — ${details.messages} messages, ${amount}`, text: lines.join('\n') };
}
