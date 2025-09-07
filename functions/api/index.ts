export interface HelloResponse {
	message: string;
}

import type { PagesFunction } from '@cloudflare/workers-types';
import type { HelloResponse as SharedHelloResponse } from '../../shared/api';

export const onRequestGet: PagesFunction = async () => {
	const body: SharedHelloResponse = { message: 'Hello from Cloudflare Workers API' };
	return new Response(JSON.stringify(body), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
};
