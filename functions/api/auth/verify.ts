/**
 * POST /api/auth/verify — trade a mailed code for a session.
 *
 * This is also where an account comes into existence: a first correct code creates it. There is
 * no separate sign-up — which is why creating one is rate-limited per IP. Every new account is
 * `DAILY_MESSAGES` of model time a day, so a script that can make thousands of them is a bill,
 * not a nuisance.
 *
 * Guessing is bounded twice over: five wrong guesses burn the code (in `redeemLoginCode`), and an
 * IP only gets so many attempts an hour across every address it tries.
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { VerifyCodeRequest, VerifyCodeResponse } from '../../../shared/api';
import {
	createSession,
	createUser,
	findUserByEmail,
	messagesLeftToday,
	redeemLoginCode,
	sessionCookie,
} from '../../../server/accounts';
import type { Env } from '../../../server/env';
import { LIMITS } from '../../../server/env';
import { clientIp, crossOrigin, fail, json, normalizeEmail, readJson, tooMany } from '../../../server/http';
import { consume } from '../../../server/ratelimit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	if (crossOrigin(request as unknown as Request)) return fail('Cross-origin request refused.', 403);

	const body = await readJson<VerifyCodeRequest>(request);
	const email = normalizeEmail(body?.email);
	const code = typeof body?.code === 'string' ? body.code.replace(/\D/g, '') : '';

	if (!email) return fail('That does not look like an email address.', 400);
	if (code.length !== 6) return fail('The code is six digits.', 400);

	const ip = clientIp(request as unknown as Request);

	const mayGuess = await consume(env, 'verify-ip', ip, LIMITS.verifyAttemptsPerIp);
	if (!mayGuess.ok) {
		return tooMany('Too many attempts. Try again later.', mayGuess.retryAfter);
	}

	const redeemed = await redeemLoginCode(env, email, code);
	if (!redeemed.ok) return fail(redeemed.reason, 401);

	// The code was right, so this is the address's owner either way. Whether they get an account
	// out of it is the only thing left to decide.
	let user = await findUserByEmail(env, email);
	const created = user === null;

	if (!user) {
		const maySignUp = await consume(env, 'signup-ip', ip, LIMITS.signupsPerIpDay);
		if (!maySignUp.ok) {
			return tooMany(
				'Too many new accounts from this connection today. Try again tomorrow.',
				maySignUp.retryAfter,
			);
		}
		user = await createUser(env, email);
	}

	const token = await createSession(env, user.id);

	const response: VerifyCodeResponse = {
		account: {
			email: user.email,
			messagesRemainingToday: await messagesLeftToday(env, user.email),
		},
		created,
	};
	return json(response, 200, { 'set-cookie': sessionCookie(token, request.url) });
};
