/** GET /api/me — who is signed in, and how much of today's allowance is left. */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { MeResponse } from '../../shared/api';
import { currentUser, messagesLeftToday } from '../../server/accounts';
import type { Env } from '../../server/env';
import { DAILY_MESSAGES } from '../../server/env';
import { json } from '../../server/http';
import { turnstileEnabled } from '../../server/turnstile';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
	const user = await currentUser(env, request as unknown as Request);

	const body: MeResponse = {
		account: user
			? { email: user.email, messagesRemainingToday: await messagesLeftToday(env, user.email) }
			: null,
		dailyMessages: DAILY_MESSAGES,
		// Public by design, and served from here so the key lives in one place rather than also
		// being baked into the bundle at build time.
		turnstileSiteKey: turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : null,
	};
	return json(body);
};
