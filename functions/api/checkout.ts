/**
 * POST /api/checkout — open a Stripe Checkout page for one bundle of messages.
 *
 * Nothing is granted here. The balance only moves when Stripe calls back at
 * `/api/stripe-webhook`, which is the only signal that money actually changed hands — the
 * browser coming back to `success_url` proves nothing.
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { CheckoutResponse } from '../../shared/api';
import { currentUser } from '../../server/accounts';
import type { Env } from '../../server/env';
import { LIMITS, MESSAGES_PER_PURCHASE, PURCHASE_PRICE_CENTS, required } from '../../server/env';
import { clientIp, crossOrigin, fail, json, tooMany } from '../../server/http';
import { consume } from '../../server/ratelimit';
import { createCheckoutSession } from '../../server/stripe';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	if (crossOrigin(request as unknown as Request)) return fail('Cross-origin request refused.', 403);

	try {
		required(env, 'DB', 'STRIPE_SECRET_KEY');
	} catch (error: unknown) {
		return fail(error instanceof Error ? error.message : 'Not configured.', 500);
	}

	const user = await currentUser(env, request as unknown as Request);
	if (!user) return fail('Sign in before buying messages.', 401);

	const opening = await consume(
		env,
		'checkout-ip',
		clientIp(request as unknown as Request),
		LIMITS.checkoutsPerIpHour,
	);
	if (!opening.ok) return tooMany('Too many checkout attempts. Try again later.', opening.retryAfter);

	const origin = new URL(request.url).origin;

	try {
		const session = await createCheckoutSession(env, {
			userId: user.id,
			email: user.email,
			messages: MESSAGES_PER_PURCHASE,
			amountCents: PURCHASE_PRICE_CENTS,
			successUrl: `${origin}/?paid=1`,
			cancelUrl: origin,
		});
		const response: CheckoutResponse = { url: session.url };
		return json(response);
	} catch (error: unknown) {
		return fail(error instanceof Error ? error.message : 'Could not open checkout.', 502);
	}
};
