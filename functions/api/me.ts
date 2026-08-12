/** GET /api/me — how many messages this browser has left, and whether a challenge is configured. */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { MeResponse } from '../../shared/api';
import type { Env } from '../../server/env';
import { MESSAGES_PER_CHALLENGE } from '../../server/env';
import { currentGrant } from '../../server/grants';
import { json } from '../../server/http';
import { turnstileEnabled } from '../../server/turnstile';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
	const grant = await currentGrant(env, request as unknown as Request);

	const body: MeResponse = {
		// No grant and a spent grant are the same thing to the browser: pass a challenge.
		messagesRemaining: grant?.remaining ?? 0,
		messagesPerChallenge: MESSAGES_PER_CHALLENGE,
		// Public by design, and served from here so the key lives in one place rather than also
		// being baked into the bundle at build time.
		turnstileSiteKey: turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : null,
	};
	return json(body);
};
