/**
 * Every binding and secret the Pages Functions read, in one place.
 *
 * Local development gets these from `.dev.vars`; production gets them from
 * `npx wrangler pages secret put <NAME>`. `DB` is a binding, not a secret — it is declared in
 * `wrangler.toml` and attached in the Pages dashboard for production.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
	/** D1 database holding the message grants and the limit counters. See `schema.sql`. */
	DB: D1Database;

	// --- answering the question
	ANTHROPIC_API_KEY: string;
	OPENROUTER_API_KEY: string;
	CLOUDFLARE_ACCOUNT_ID: string;
	CLOUDFLARE_AI_TOKEN: string;

	// --- bot challenge (Turnstile). Optional: absent means the challenge is not shown or checked.
	/** Public, and handed to the browser by `/api/me`. Could equally be a plain var. */
	TURNSTILE_SITE_KEY: string;
	TURNSTILE_SECRET_KEY: string;

	/** Pages static-asset binding; absent under some `wrangler pages dev` invocations. */
	ASSETS?: {
		fetch(input: string): Promise<{
			ok: boolean;
			status: number;
			headers: { get(name: string): string | null };
		}>;
	};
}

/**
 * How many questions one passed challenge is worth.
 *
 * There is nothing to buy here, nothing to sign in to, and no daily reset. A Turnstile challenge
 * is the entitlement: pass one, get this many messages; spend them, pass another. The count lives
 * on a grant row keyed by the cookie the challenge issued — see `server/grants.ts`.
 *
 * Nothing else meters anything. There are no per-IP counters and nothing about a visitor is
 * stored, because Turnstile is already deciding how hard it is to pass a challenge and how often
 * — doing it a second time in application code would only be a worse copy of that. This number is
 * what a solved challenge costs, and it is the only lever here. If that ever stops being enough,
 * the answer is a Cloudflare WAF rate-limiting rule on `/api/challenge`, which runs at the edge
 * before any of this does.
 */
export const MESSAGES_PER_CHALLENGE = 10;

/** Throws a readable error naming what is missing, rather than failing somewhere deeper. */
export function required(env: Env, ...names: (keyof Env)[]): void {
	const missing = names.filter((name) => !env[name]);
	if (missing.length > 0) {
		throw new Error(`${missing.join(', ')} is not set on this deployment.`);
	}
}
