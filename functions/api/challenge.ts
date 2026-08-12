/**
 * POST /api/challenge — trade a solved Turnstile challenge for messages.
 *
 * This is the whole of the entitlement: no address, no account, no sign-in. Passing the challenge
 * puts `MESSAGES_PER_CHALLENGE` messages on an opaque cookie, and passing another one when they
 * run out fills it back up.
 *
 * Which makes this the endpoint worth attacking, since it is the one that hands out model time.
 * The challenge is the only thing standing in the way, and deliberately so: Turnstile already
 * decides how hard a given visitor has to work and how often, so nothing here counts anything or
 * remembers anyone.
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { ChallengeRequest, ChallengeResponse } from '../../shared/api';
import type { Env } from '../../server/env';
import { required } from '../../server/env';
import { grantCookie, grantMessages, sweepExpiredGrants } from '../../server/grants';
import { clientIp, crossOrigin, fail, json, readJson } from '../../server/http';
import { verifyTurnstile } from '../../server/turnstile';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	if (crossOrigin(request as unknown as Request)) return fail('Cross-origin request refused.', 403);

	try {
		required(env, 'DB');
	} catch (error: unknown) {
		return fail(error instanceof Error ? error.message : 'Not configured.', 500);
	}

	const body = await readJson<ChallengeRequest>(request);
	const ip = clientIp(request as unknown as Request);

	// The address is handed to Cloudflare rather than kept: siteverify uses it to check the token
	// was issued to this visitor, which is the anti-replay half of the challenge.
	const challenge = await verifyTurnstile(env, body?.turnstileToken, ip === 'local' ? null : ip);
	if (!challenge.ok) return fail(challenge.reason, 403);

	const granted = await grantMessages(env, request as unknown as Request);

	await sweepExpiredGrants(env);

	const response: ChallengeResponse = { messagesRemaining: granted.remaining };
	return json(response, 200, { 'set-cookie': grantCookie(granted.token, request.url) });
};
