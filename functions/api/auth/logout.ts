/** POST /api/auth/logout — drop this session. The account and its balance are untouched. */

import type { PagesFunction } from '@cloudflare/workers-types';
import { clearedCookie, destroySession } from '../../../server/accounts';
import type { Env } from '../../../server/env';
import { crossOrigin, fail, json } from '../../../server/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	if (crossOrigin(request as unknown as Request)) return fail('Cross-origin request refused.', 403);

	await destroySession(env, request as unknown as Request);
	return json({ ok: true }, 200, { 'set-cookie': clearedCookie(request.url) });
};
