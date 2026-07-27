/** GET /api/me — who is signed in, and what a purchase costs. */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { MeResponse } from '../../shared/api';
import { currentUser } from '../../server/accounts';
import type { Env } from '../../server/env';
import { MESSAGES_PER_PURCHASE, PURCHASE_PRICE_CENTS } from '../../server/env';
import { json } from '../../server/http';
import { turnstileEnabled } from '../../server/turnstile';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
	const user = await currentUser(env, request as unknown as Request);

	const body: MeResponse = {
		account: user ? { email: user.email, messagesRemaining: user.messagesRemaining } : null,
		pricing: { messages: MESSAGES_PER_PURCHASE, priceCents: PURCHASE_PRICE_CENTS },
		// Public by design, and served from here so the key lives in one place rather than also
		// being baked into the bundle at build time.
		turnstileSiteKey: turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : null,
	};
	return json(body);
};
