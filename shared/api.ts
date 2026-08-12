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
	/** Sent once, before the answer, with what is left of the grant after this one. */
	| { type: 'balance'; remaining: number }
	| { type: 'done' };

// ---------------------------------------------------------------- messages

/** GET /api/me — what this browser may ask, and whether a challenge stands in the way. */
export interface MeResponse {
	/** Messages left on this browser's grant. Zero means a challenge is needed; so does no grant. */
	messagesRemaining: number;
	/** What one passed challenge is worth, so the copy can name the number from the server. */
	messagesPerChallenge: number;
	/** Turnstile's public key, or null when the challenge is not configured on this deployment. */
	turnstileSiteKey: string | null;
}

/** POST /api/challenge — trade a solved challenge for messages. */
export interface ChallengeRequest {
	/** The Turnstile widget's token. Required whenever `turnstileSiteKey` is set. */
	turnstileToken?: string;
}

export interface ChallengeResponse {
	messagesRemaining: number;
}
