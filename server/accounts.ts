/**
 * Accounts and sessions.
 *
 * An account is an email address and a number of messages remaining, nothing else. Proving you
 * own the address is the whole of authentication: a six-digit code is mailed to it, and getting
 * that code back creates the account if it does not exist yet.
 *
 * Sessions are opaque random tokens held in an HttpOnly cookie. Only their SHA-256 hashes reach
 * the database, so a leaked copy of the table cannot be used to log in as anyone.
 */

import type { Env } from './env';
import { FREE_MESSAGES } from './env';
import { now, randomHex, sha256Hex, timingSafeEqual } from './http';

export interface User {
	id: string;
	email: string;
	messagesRemaining: number;
}

const COOKIE_NAME = 'coj_session';
const SESSION_DAYS = 90;

/** How long a mailed code stays good, and how many guesses it survives. */
const CODE_TTL_SECONDS = 10 * 60;
const CODE_MAX_ATTEMPTS = 5;
/** One code per address per this many seconds, so nobody's inbox can be used as a weapon. */
const CODE_COOLDOWN_SECONDS = 45;

// ---------------------------------------------------------------- sign-in codes

export type CodeRequest = { ok: true; code: string } | { ok: false; retryAfter: number };

/**
 * Mints a code for an address and stores its hash, replacing any outstanding one. Returns the
 * plaintext code exactly once, for the caller to put in an email — it is never readable again.
 */
export async function issueLoginCode(env: Env, email: string): Promise<CodeRequest> {
	const timestamp = now();

	const existing = await env.DB.prepare('SELECT sent_at FROM login_codes WHERE email = ?')
		.bind(email)
		.first<{ sent_at: number }>();

	if (existing && timestamp - existing.sent_at < CODE_COOLDOWN_SECONDS) {
		return { ok: false, retryAfter: CODE_COOLDOWN_SECONDS - (timestamp - existing.sent_at) };
	}

	// Uniform over 000000–999999; leading zeros are kept so every code is six characters.
	const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');

	await env.DB.prepare(
		`INSERT INTO login_codes (email, code_hash, expires_at, attempts, sent_at)
		 VALUES (?, ?, ?, 0, ?)
		 ON CONFLICT(email) DO UPDATE SET
		   code_hash = excluded.code_hash,
		   expires_at = excluded.expires_at,
		   attempts = 0,
		   sent_at = excluded.sent_at`,
	)
		.bind(email, await sha256Hex(code), timestamp + CODE_TTL_SECONDS, timestamp)
		.run();

	return { ok: true, code };
}

export type CodeCheck = { ok: true } | { ok: false; reason: string };

/** Spends a code: one success or one too many failures and it is gone either way. */
export async function redeemLoginCode(env: Env, email: string, code: string): Promise<CodeCheck> {
	const row = await env.DB.prepare(
		'SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?',
	)
		.bind(email)
		.first<{ code_hash: string; expires_at: number; attempts: number }>();

	if (!row) return { ok: false, reason: 'That code has expired. Ask for a new one.' };

	if (row.expires_at < now() || row.attempts >= CODE_MAX_ATTEMPTS) {
		await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
		return { ok: false, reason: 'That code has expired. Ask for a new one.' };
	}

	if (!timingSafeEqual(row.code_hash, await sha256Hex(code.trim()))) {
		await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?')
			.bind(email)
			.run();
		return { ok: false, reason: 'That code is not right.' };
	}

	await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
	return { ok: true };
}

// ---------------------------------------------------------------- accounts

/**
 * Creates the account for an address with its free messages, or returns the one already there.
 *
 * Kept separate from the lookup so a caller can decide whether it is willing to create an account
 * at all — creating one gives `FREE_MESSAGES` of model time away, and `verify.ts` rate-limits
 * that before it gets here.
 */
export async function createUser(env: Env, email: string): Promise<User> {
	const id = crypto.randomUUID();
	// A second sign-in racing the first would collide on the unique email; ignore and re-read.
	await env.DB.prepare(
		`INSERT INTO users (id, email, messages_remaining, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(email) DO NOTHING`,
	)
		.bind(id, email, FREE_MESSAGES, now())
		.run();

	const user = await findUserByEmail(env, email);
	if (!user) throw new Error('Could not create the account.');
	return user;
}

export async function findUserByEmail(env: Env, email: string): Promise<User | null> {
	const row = await env.DB.prepare(
		'SELECT id, email, messages_remaining FROM users WHERE email = ?',
	)
		.bind(email)
		.first<{ id: string; email: string; messages_remaining: number }>();
	return row ? { id: row.id, email: row.email, messagesRemaining: row.messages_remaining } : null;
}

/** Adds messages to an account. Returns false if the account is gone (deleted mid-checkout). */
export async function grantMessages(env: Env, userId: string, count: number): Promise<boolean> {
	const result = await env.DB.prepare(
		'UPDATE users SET messages_remaining = messages_remaining + ? WHERE id = ?',
	)
		.bind(count, userId)
		.run();
	return (result.meta.changes ?? 0) > 0;
}

/**
 * Takes one message off the balance, atomically. Returns false when there was none to take —
 * checking first and then decrementing would let two questions in flight share one message.
 */
export async function spendMessage(env: Env, userId: string): Promise<boolean> {
	const result = await env.DB.prepare(
		'UPDATE users SET messages_remaining = messages_remaining - 1 WHERE id = ? AND messages_remaining > 0',
	)
		.bind(userId)
		.run();
	return (result.meta.changes ?? 0) > 0;
}

/** Puts a spent message back when the answer never happened. */
export async function refundMessage(env: Env, userId: string): Promise<void> {
	await env.DB.prepare('UPDATE users SET messages_remaining = messages_remaining + 1 WHERE id = ?')
		.bind(userId)
		.run();
}

/**
 * Erases the account. The payment ledger keeps its rows — they are the record behind an invoice —
 * but is unlinked from the person, so nothing identifying survives.
 */
export async function deleteUser(env: Env, user: User): Promise<void> {
	await env.DB.batch([
		env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
		env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(user.email),
		env.DB.prepare('UPDATE purchases SET user_id = NULL WHERE user_id = ?').bind(user.id),
		env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
	]);
}

// ---------------------------------------------------------------- sessions

/** Issues a session and returns the raw token; only its hash is stored. */
export async function createSession(env: Env, userId: string): Promise<string> {
	const token = randomHex(32);
	await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
		.bind(await sha256Hex(token), userId, now() + SESSION_DAYS * 24 * 60 * 60)
		.run();
	return token;
}

/** The signed-in user for a request, or null. Expired rows are cleaned up as they are found. */
export async function currentUser(env: Env, request: Request): Promise<User | null> {
	const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
	if (!token) return null;

	const hash = await sha256Hex(token);
	const row = await env.DB.prepare(
		`SELECT users.id, users.email, users.messages_remaining, sessions.expires_at
		 FROM sessions JOIN users ON users.id = sessions.user_id
		 WHERE sessions.token_hash = ?`,
	)
		.bind(hash)
		.first<{ id: string; email: string; messages_remaining: number; expires_at: number }>();

	if (!row) return null;
	if (row.expires_at < now()) {
		await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
		return null;
	}

	return { id: row.id, email: row.email, messagesRemaining: row.messages_remaining };
}

export async function destroySession(env: Env, request: Request): Promise<void> {
	const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
	if (!token) return;
	await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
		.bind(await sha256Hex(token))
		.run();
}

/**
 * `Secure` is set only on https, because local development is plain http on localhost and the
 * browser would silently drop the cookie. `SameSite=Lax` still lets the cookie ride along on the
 * top-level redirect back from Stripe.
 */
export function sessionCookie(token: string, url: string): string {
	const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
	const maxAge = SESSION_DAYS * 24 * 60 * 60;
	return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearedCookie(url: string): string {
	const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
	return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function readCookie(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index === -1) continue;
		if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
	}
	return null;
}
