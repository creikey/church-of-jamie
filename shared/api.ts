export interface HelloResponse {
	message: string;
}

/** One turn of the conversation as the browser stores it. */
export interface ChatMessage {
	role: 'seeker' | 'jamie';
	text: string;
}

export interface AskRequest {
	question: string;
	/** Prior turns of this conversation. The server keeps only the most recent few. */
	history?: ChatMessage[];
}

/** Server-sent events streamed back from POST /api/ask. */
export type AskEvent =
	| { type: 'text'; text: string }
	| { type: 'error'; message: string }
	/** Sent once, before the answer, with what is left after paying for this one. */
	| { type: 'balance'; remaining: number }
	| { type: 'done' };

// ---------------------------------------------------------------- accounts

/** Everything an account is. There is nothing else stored about a person. */
export interface Account {
	email: string;
	messagesRemaining: number;
}

/** GET /api/me — `account` is null when nobody is signed in. */
export interface MeResponse {
	account: Account | null;
	/** What one purchase costs and buys, so the button can label itself from the server. */
	pricing: { messages: number; priceCents: number };
	/** Turnstile's public key, or null when the challenge is not configured on this deployment. */
	turnstileSiteKey: string | null;
}

/** POST /api/auth/request-code */
export interface RequestCodeRequest {
	email: string;
	/** The Turnstile widget's token. Required whenever `turnstileSiteKey` is set. */
	turnstileToken?: string;
}

export interface RequestCodeResponse {
	/** Echoed back so the verify step can show which address the code went to. */
	email: string;
}

/** POST /api/auth/verify */
export interface VerifyCodeRequest {
	email: string;
	code: string;
}

export interface VerifyCodeResponse {
	account: Account;
	/** True the first time an address signs in, when the free messages were granted. */
	created: boolean;
}

/** POST /api/checkout — the hosted Stripe page to send the browser to. */
export interface CheckoutResponse {
	url: string;
}
