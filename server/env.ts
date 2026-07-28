/**
 * Every binding and secret the Pages Functions read, in one place.
 *
 * Local development gets these from `.dev.vars`; production gets them from
 * `npx wrangler pages secret put <NAME>`. `DB` is a binding, not a secret — it is declared in
 * `wrangler.toml` and attached in the Pages dashboard for production.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
	/** D1 database holding accounts, sessions and the payment ledger. See `schema.sql`. */
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

	// --- payments (Stripe)
	STRIPE_SECRET_KEY: string;
	/** `whsec_...` from the webhook endpoint, used to verify that a callback really is Stripe. */
	STRIPE_WEBHOOK_SECRET: string;

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

/** Messages granted the first time an address signs in. */
export const FREE_MESSAGES = 10;

/** What $5 buys. */
export const MESSAGES_PER_PURCHASE = 100;

/** Price of one purchase, in cents. */
export const PURCHASE_PRICE_CENTS = 500;

/**
 * What tax authorities think is being sold, in Stripe's classification.
 *
 * `txcd_10105001` is "Artificial Intelligence as a Service — Cloud Based — Personal Use", which
 * Stripe defines as access to AI tools such as chatbots, hosted entirely on the provider's servers
 * and reached through a browser, bought for personal rather than business use. That is this
 * product, said back exactly.
 *
 * Managed Payments will not open a Checkout Session without one, because Stripe is the merchant of
 * record and this is what it computes VAT and sales tax from. Changing what is sold here means
 * changing this too — the full list is at https://docs.stripe.com/tax/tax-codes, and picking the
 * right one is a tax question rather than a programming one.
 */
export const PRODUCT_TAX_CODE = 'txcd_10105001';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

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
	 * New accounts one IP may create in a day. Each one is `FREE_MESSAGES` of model time given
	 * away, so this is the limit standing between a script and the bill.
	 */
	signupsPerIpDay: { limit: 5, windowSeconds: DAY },
	/** Checkout pages one IP may open. Stripe meters its own API; this just keeps the noise down. */
	checkoutsPerIpHour: { limit: 20, windowSeconds: HOUR },
} as const;

/** Throws a readable error naming what is missing, rather than failing somewhere deeper. */
export function required(env: Env, ...names: (keyof Env)[]): void {
	const missing = names.filter((name) => !env[name]);
	if (missing.length > 0) {
		throw new Error(`${missing.join(', ')} is not set on this deployment.`);
	}
}
