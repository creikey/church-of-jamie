/** Small helpers shared by every endpoint under `functions/api/`. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
	});
}

export function fail(message: string, status: number): Response {
	return json({ error: message }, status);
}

/** 429 with the header that tells a well-behaved client when to come back. */
export function tooMany(message: string, retryAfter: number): Response {
	return json({ error: message }, 429, { 'retry-after': String(retryAfter) });
}

/**
 * The visitor's address, as Cloudflare saw it — a header the edge sets and strips from anything
 * inbound, so it cannot be spoofed the way `X-Forwarded-For` can. Absent under `wrangler pages
 * dev`, where every request then shares one bucket; that is only ever the case locally.
 */
export function clientIp(request: Request): string {
	return request.headers.get('cf-connecting-ip') ?? 'local';
}

/**
 * True when a browser is submitting this from somewhere that is not this site.
 *
 * The session cookie is already `SameSite=Lax`, which is what actually stops cross-site requests
 * from carrying it. This is the second lock: cheap, and it does not depend on getting the cookie
 * attributes right. A missing `Origin` means a non-browser client, which has no cookie to ride on
 * in the first place.
 */
export function crossOrigin(request: Request): boolean {
	const origin = request.headers.get('origin');
	if (!origin) return false;
	try {
		return new URL(origin).origin !== new URL(request.url).origin;
	} catch {
		return true;
	}
}

/** Reads a JSON body, or null if it is absent or malformed. */
export async function readJson<T>(request: { json(): Promise<unknown> }): Promise<T | null> {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
}

/** Seconds since the epoch — every timestamp in D1 is stored this way. */
export function now(): number {
	return Math.floor(Date.now() / 1000);
}

export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes: number): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return [...buffer].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison, so a mismatch reveals nothing about where it happened. */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}

/**
 * Deliberately permissive: the address only has to be good enough to hand to the mail provider,
 * and the code that arrives in the inbox is what actually proves ownership.
 */
export function normalizeEmail(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const email = raw.trim().toLowerCase();
	if (email.length < 3 || email.length > 254) return null;
	if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
	return email;
}
