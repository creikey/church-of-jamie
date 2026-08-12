/**
 * DELETE /api/account — erase the account.
 *
 * Immediate and unconfirmed by email, because there is nothing here worth a confirmation step:
 * an account is an address. Whatever is left of today's allowance stays spent — that counter is
 * keyed on the address, not the account, so signing up again lands in the same day's bucket.
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import { clearedCookie, currentUser, deleteUser } from '../../server/accounts';
import type { Env } from '../../server/env';
import { crossOrigin, fail, json } from '../../server/http';

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
	if (crossOrigin(request as unknown as Request)) return fail('Cross-origin request refused.', 403);

	const user = await currentUser(env, request as unknown as Request);
	if (!user) return fail('You are not signed in.', 401);

	await deleteUser(env, user);
	return json({ ok: true }, 200, { 'set-cookie': clearedCookie(request.url) });
};
