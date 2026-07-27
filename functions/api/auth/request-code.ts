/**
 * POST /api/auth/request-code — mail a six-digit sign-in code to an address.
 *
 * This is the one endpoint that sends mail to an address nobody has proved they own, which makes
 * it the one worth attacking: a script walking a list of addresses turns this site into a mail
 * cannon, burns the monthly send quota, and gets the sending domain blacklisted. Three things stand in
 * the way, in this order — a Turnstile challenge, a per-IP limit, and a per-address limit. The
 * per-address one alone would be useless here, since every request in that attack uses a
 * different address.
 *
 * The response never says whether the address already has an account. Signing in and signing up
 * are the same flow, so there is nothing here to tell them apart with.
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { RequestCodeRequest, RequestCodeResponse } from '../../../shared/api';
import { issueLoginCode } from '../../../server/accounts';
import type { Env } from '../../../server/env';
import { LIMITS, required } from '../../../server/env';
import { signInEmail, sendEmail } from '../../../server/email';
import { clientIp, crossOrigin, fail, json, normalizeEmail, readJson, tooMany } from '../../../server/http';
import { consumeAll, sweepExpired } from '../../../server/ratelimit';
import { verifyTurnstile } from '../../../server/turnstile';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	if (crossOrigin(request as unknown as Request)) return fail('Cross-origin request refused.', 403);

	try {
		required(env, 'DB', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_TOKEN', 'EMAIL_FROM');
	} catch (error: unknown) {
		return fail(error instanceof Error ? error.message : 'Not configured.', 500);
	}

	const body = await readJson<RequestCodeRequest>(request);
	const email = normalizeEmail(body?.email);
	if (!email) return fail('That does not look like an email address.', 400);

	const ip = clientIp(request as unknown as Request);

	// The challenge comes before the limits so that a person who solves it is not spending anyone
	// else's budget, and before any mail is sent so a bot never causes one.
	const challenge = await verifyTurnstile(env, body?.turnstileToken, ip === 'local' ? null : ip);
	if (!challenge.ok) return fail(challenge.reason, 403);

	const allowed = await consumeAll(env, [
		{ scope: 'code-ip', identity: ip, limit: LIMITS.codeRequestsPerIp },
		{ scope: 'code-email-h', identity: email, limit: LIMITS.codeRequestsPerEmailHour },
		{ scope: 'code-email-d', identity: email, limit: LIMITS.codeRequestsPerEmailDay },
	]);
	if (!allowed.ok) {
		return tooMany('Too many codes have been asked for. Try again later.', allowed.retryAfter);
	}

	const issued = await issueLoginCode(env, email);
	if (!issued.ok) {
		return tooMany(
			`A code was just sent. Check your inbox, or try again in ${issued.retryAfter} seconds.`,
			issued.retryAfter,
		);
	}

	try {
		const { subject, text } = signInEmail(issued.code);
		await sendEmail(env, { to: email, subject, text });
	} catch (error: unknown) {
		return fail(error instanceof Error ? error.message : 'Could not send the code.', 502);
	}

	await sweepExpired(env);

	const response: RequestCodeResponse = { email };
	return json(response);
};
