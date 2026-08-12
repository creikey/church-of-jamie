/**
 * Every binding and secret the Pages Functions read, in one place.
 *
 * Local development gets these from `.dev.vars`; production gets them from
 * `npx wrangler pages secret put <NAME>`. `DB` is a binding, not a secret — it is declared in
 * `wrangler.toml` and attached in the Pages dashboard for production.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
	/** D1 database holding accounts, sessions, sign-in codes and the limit counters. See `schema.sql`. */
	DB: D1Database;

	// --- answering the question
	ANTHROPIC_API_KEY: string;
	OPENROUTER_API_KEY: string;
	CLOUDFLARE_ACCOUNT_ID: string;
	CLOUDFLARE_AI_TOKEN: string;

	// --- email (Cloudflare Email Service; the account id above is used as well)
	/** API token with the account-level "Email Sending: Edit" permission. */
	CLOUDFLARE_EMAIL_TOKEN: string;
	/** Who mail comes from, e.g. `Church of Jamie <jamie@example.com>`. Must be an onboarded domain. */
	EMAIL_FROM: string;

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

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * How many questions one address may ask in a day.
 *
 * There is nothing to buy here and no balance to carry: an account is an address, and the address
 * gets this many messages every day. Nothing is stored per account to make that work — the
 * allowance is counted by the same fixed-window counter as every other limit below, keyed on the
 * address, so signing out, signing back in, or deleting the account and starting again all land
 * in the same bucket.
 *
 * The window is a fixed 24 hours aligned to midnight UTC, not a rolling one. Somebody who spends
 * all fifty just before midnight has fifty more a minute later; that is the coarseness the whole
 * limiter is built on, and it costs at most one extra day's worth of model time.
 *
 * This number is the model bill. Changing it changes what one address can cost.
 */
export const DAILY_MESSAGES = 50;

/**
 * Every abuse limit, in one table.
 *
 * The two that carry real weight are the sign-in code limits. Together with the five guesses a
 * single code survives, they cap an attacker at 15 codes × 5 guesses = 75 attempts a day against
 * one address, out of a million — call it 2.7% over a year of trying, while mailing that person
 * fifteen times a day, every day, for them to notice. That is the trade a six-digit code makes.
 * Raising the code to eight digits (`issueLoginCode` in `accounts.ts`) removes even that, at the
 * cost of two more keystrokes.
 */
export const LIMITS = {
	/** Sign-in codes one IP may ask for. This is the mail-cannon limit. */
	codeRequestsPerIp: { limit: 10, windowSeconds: HOUR },
	/** Sign-in codes one address may be sent, on top of the 45-second cooldown between them. */
	codeRequestsPerEmailHour: { limit: 5, windowSeconds: HOUR },
	codeRequestsPerEmailDay: { limit: 15, windowSeconds: DAY },
	/** Codes one IP may guess at, across every address. */
	verifyAttemptsPerIp: { limit: 20, windowSeconds: HOUR },
	/**
	 * New accounts one IP may create in a day. Every account is `DAILY_MESSAGES` of model time a
	 * day, for as long as it is used, so this is the limit standing between a script and the bill.
	 */
	signupsPerIpDay: { limit: 5, windowSeconds: DAY },
	/** The daily allowance itself. Keyed on the address — see `DAILY_MESSAGES`. */
	messagesPerEmailDay: { limit: DAILY_MESSAGES, windowSeconds: DAY },
} as const;

/** Throws a readable error naming what is missing, rather than failing somewhere deeper. */
export function required(env: Env, ...names: (keyof Env)[]): void {
	const missing = names.filter((name) => !env[name]);
	if (missing.length > 0) {
		throw new Error(`${missing.join(', ')} is not set on this deployment.`);
	}
}
