/**
 * Cloudflare Turnstile — the only thing standing between a script and the model bill.
 *
 * A passed challenge is what buys messages here; there is nothing else to prove and nobody to be.
 * The per-IP limits in `env.ts` bound how many grants one connection can claim, but they are a
 * ceiling, not a gate. Turnstile is what makes claiming one cost something in the first place.
 *
 * It is optional so that local development works with nothing configured, and `/api/me` reports
 * whether it is on so the panel knows whether to draw a widget. Leaving it off in production
 * means anyone can help themselves to messages in a loop — see the README.
 */

import type { Env } from './env';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Turnstile is enforced only when both halves of the key pair are present. */
export function turnstileEnabled(env: Env): boolean {
	return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

/**
 * Tokens are single-use and short-lived; a replayed one comes back as `timeout-or-duplicate`,
 * which is why the browser resets the widget after every attempt.
 */
export async function verifyTurnstile(
	env: Env,
	token: unknown,
	remoteIp: string | null,
): Promise<TurnstileResult> {
	if (!turnstileEnabled(env)) return { ok: true };

	if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
		return { ok: false, reason: 'Finish the checkbox below, then try again.' };
	}

	let payload: { success?: boolean; 'error-codes'?: string[] };
	try {
		const response = await fetch(VERIFY_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				secret: env.TURNSTILE_SECRET_KEY,
				response: token,
				...(remoteIp ? { remoteip: remoteIp } : {}),
			}),
		});
		payload = (await response.json()) as typeof payload;
	} catch {
		// Cloudflare being unreachable must not lock everyone out of signing in.
		console.error('Turnstile verification is unreachable; allowing the request through.');
		return { ok: true };
	}

	if (payload.success) return { ok: true };

	const codes = payload['error-codes'] ?? [];
	console.error('Turnstile rejected a token', codes);

	// A bad secret is a deployment mistake, not something the visitor can fix by trying again.
	if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
		return { ok: false, reason: 'TURNSTILE_SECRET_KEY is wrong on this deployment.' };
	}
	return { ok: false, reason: 'That challenge did not pass. Try again.' };
}
