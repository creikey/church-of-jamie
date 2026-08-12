/**
 * The message allowance, and the cookie that carries it.
 *
 * There are no accounts here and nothing to sign in to. Passing the Turnstile challenge is the
 * whole of the entitlement: it hands the browser an opaque token good for `MESSAGES_PER_CHALLENGE`
 * messages, and passing another challenge fills it back up. Nothing about the person is stored —
 * a grant is a hash, a number, and an expiry.
 *
 * Only the token's SHA-256 hash reaches the database, so a leaked copy of the table cannot be
 * turned back into a working cookie.
 */

import type { Env } from './env';
import { MESSAGES_PER_CHALLENGE } from './env';
import { now, randomHex, sha256Hex } from './http';

export interface Grant {
	/** How the row is addressed. Held here so spending and refunding need not re-hash the cookie. */
	tokenHash: string;
	remaining: number;
}

const COOKIE_NAME = 'coj_messages';
const GRANT_DAYS = 30;
/** A cookie longer than this is not something this site issued; do not bother hashing it. */
const MAX_TOKEN_CHARS = 128;

/**
 * Records a passed challenge, and returns the token the browser should hold from now on.
 *
 * A browser that already has a grant keeps the same token and has it topped up rather than
 * accumulating: passing ten challenges in a row is worth `MESSAGES_PER_CHALLENGE` messages, not
 * ten times that. Stacking is the only thing that would make solving challenges in bulk pay.
 */
export async function grantMessages(
	env: Env,
	request: Request,
): Promise<{ token: string; remaining: number }> {
	const token = readCookie(request.headers.get('cookie'), COOKIE_NAME) ?? randomHex(32);
	const tokenHash = await sha256Hex(token);

	const row = await env.DB.prepare(
		`INSERT INTO grants (token_hash, remaining, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(token_hash) DO UPDATE SET
		   remaining = MAX(grants.remaining, excluded.remaining),
		   expires_at = excluded.expires_at
		 RETURNING remaining`,
	)
		.bind(tokenHash, MESSAGES_PER_CHALLENGE, now() + GRANT_DAYS * 24 * 60 * 60)
		.first<{ remaining: number }>();

	return { token, remaining: row?.remaining ?? MESSAGES_PER_CHALLENGE };
}

/**
 * The grant this request carries, or null when it carries none. An expired one is cleaned up as
 * it is found and counts as none.
 */
export async function currentGrant(env: Env, request: Request): Promise<Grant | null> {
	const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
	if (!token) return null;

	const tokenHash = await sha256Hex(token);
	const row = await env.DB.prepare('SELECT remaining, expires_at FROM grants WHERE token_hash = ?')
		.bind(tokenHash)
		.first<{ remaining: number; expires_at: number }>();

	if (!row) return null;
	if (row.expires_at < now()) {
		await env.DB.prepare('DELETE FROM grants WHERE token_hash = ?').bind(tokenHash).run();
		return null;
	}

	return { tokenHash, remaining: row.remaining };
}

export type Spend = { ok: true; remaining: number } | { ok: false };

/**
 * Spends one message, atomically. Two questions sent at once cannot share the last one: the
 * decrement and the read are a single statement, so the second sees its own number — and the
 * `remaining > 0` guard is what makes it fail rather than go negative.
 */
export async function spendMessage(env: Env, grant: Grant): Promise<Spend> {
	const row = await env.DB.prepare(
		`UPDATE grants SET remaining = remaining - 1
		 WHERE token_hash = ? AND remaining > 0 AND expires_at > ?
		 RETURNING remaining`,
	)
		.bind(grant.tokenHash, now())
		.first<{ remaining: number }>();

	return row ? { ok: true, remaining: row.remaining } : { ok: false };
}

/**
 * Puts a spent message back when the answer never happened. Capped at a full grant so a double
 * refund cannot mint messages out of nothing.
 */
export async function refundMessage(env: Env, grant: Grant): Promise<void> {
	await env.DB.prepare(
		'UPDATE grants SET remaining = remaining + 1 WHERE token_hash = ? AND remaining < ?',
	)
		.bind(grant.tokenHash, MESSAGES_PER_CHALLENGE)
		.run();
}

/**
 * `Secure` is set only on https, because local development is plain http on localhost and the
 * browser would silently drop the cookie.
 */
export function grantCookie(token: string, url: string): string {
	const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
	const maxAge = GRANT_DAYS * 24 * 60 * 60;
	return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index === -1) continue;
		if (part.slice(0, index).trim() !== name) continue;
		const value = part.slice(index + 1).trim();
		return value && value.length <= MAX_TOKEN_CHARS ? value : null;
	}
	return null;
}

/**
 * Clears out grants that have aged out. There is no cron in a Pages Function, so it rides along on
 * a small fraction of requests instead; the table is only ever read by primary key, so a late
 * sweep costs nothing but disk.
 */
export async function sweepExpiredGrants(env: Env): Promise<void> {
	if (Math.random() > 0.02) return;

	try {
		await env.DB.prepare('DELETE FROM grants WHERE expires_at < ?').bind(now()).run();
	} catch (error: unknown) {
		// Housekeeping must never take a request down with it.
		console.error('Sweep failed', error);
	}
}
