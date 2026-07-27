/**
 * Fixed-window rate limiting, counted in D1.
 *
 * Cloudflare's own rate limiting lives in the WAF and is configured in the dashboard, which means
 * it is invisible from the repository and easy to lose. These limits are the ones the application
 * cannot be correct without — how many sign-in codes an address may be sent, how many an address
 * may be guessed at — so they live in the code next to what they protect.
 *
 * A fixed window is coarse: an attacker who times it right gets up to twice the limit across a
 * window boundary. That is fine for what this defends. The point is to turn "unlimited" into "a
 * small number per hour", not to meter precisely.
 */

import type { Env } from './env';
import { now } from './http';

export interface Limit {
	/** How many are allowed in one window. */
	limit: number;
	windowSeconds: number;
}

export type Verdict = { ok: true } | { ok: false; retryAfter: number };

/**
 * Counts one hit against `scope:identity` and says whether it is over the line.
 *
 * The over-limit hit is counted too, so hammering does not reset anything — but the window still
 * expires on schedule, so a legitimate person who trips a limit is never locked out for longer
 * than one window.
 */
export async function consume(
	env: Env,
	scope: string,
	identity: string,
	limit: Limit,
): Promise<Verdict> {
	const timestamp = now();
	const window = Math.floor(timestamp / limit.windowSeconds);
	const expiresAt = (window + 1) * limit.windowSeconds;

	const row = await env.DB.prepare(
		`INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
		 ON CONFLICT(bucket) DO UPDATE SET count = count + 1
		 RETURNING count`,
	)
		.bind(`${scope}:${identity}:${window}`, expiresAt)
		.first<{ count: number }>();

	if ((row?.count ?? 1) > limit.limit) {
		return { ok: false, retryAfter: Math.max(1, expiresAt - timestamp) };
	}
	return { ok: true };
}

/** Applies several limits, hardest-hit first. Every one is counted, so none can be starved. */
export async function consumeAll(
	env: Env,
	checks: { scope: string; identity: string; limit: Limit }[],
): Promise<Verdict> {
	const verdicts = await Promise.all(
		checks.map((check) => consume(env, check.scope, check.identity, check.limit)),
	);

	let worst: Verdict = { ok: true };
	for (const verdict of verdicts) {
		if (!verdict.ok && (worst.ok || verdict.retryAfter > worst.retryAfter)) worst = verdict;
	}
	return worst;
}

/**
 * Clears out everything that has aged out — rate-limit windows, spent sign-in codes, dead
 * sessions. There is no cron here, so it rides along on a small fraction of requests instead;
 * none of these tables is read by scan, so a late sweep costs nothing but disk.
 */
export async function sweepExpired(env: Env): Promise<void> {
	if (Math.random() > 0.02) return;

	const timestamp = now();
	try {
		await env.DB.batch([
			env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(timestamp),
			env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(timestamp),
			env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(timestamp),
		]);
	} catch (error: unknown) {
		// Housekeeping must never take a request down with it.
		console.error('Sweep failed', error);
	}
}
