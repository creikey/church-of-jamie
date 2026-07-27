-- D1 schema for accounts, sign-in codes, sessions, and the payment ledger.
--
-- Apply it with:
--   npx wrangler d1 execute church-of-jamie --local --file=./schema.sql   (local dev)
--   npx wrangler d1 execute church-of-jamie --remote --file=./schema.sql  (production)
--
-- Every statement is idempotent, so re-running it after a schema change is safe.

-- One row per account. `messages_remaining` is the only thing an account actually stores.
CREATE TABLE IF NOT EXISTS users (
	id                 TEXT PRIMARY KEY,
	email              TEXT NOT NULL UNIQUE,
	messages_remaining INTEGER NOT NULL DEFAULT 0,
	created_at         INTEGER NOT NULL
);

-- The six-digit code sent to an address, hashed. At most one outstanding code per address:
-- asking for a new one overwrites the old, which is also what invalidates it.
CREATE TABLE IF NOT EXISTS login_codes (
	email      TEXT PRIMARY KEY,
	code_hash  TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	attempts   INTEGER NOT NULL DEFAULT 0,
	sent_at    INTEGER NOT NULL
);

-- Session tokens, stored as SHA-256 hashes so the table is useless to anyone who reads it.
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id    TEXT NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);

-- Fixed-window counters behind every abuse limit. `bucket` already encodes the window, so an
-- expired row is simply never read again — `sweepExpired` in server/ratelimit.ts clears them out.
CREATE TABLE IF NOT EXISTS rate_limits (
	bucket     TEXT PRIMARY KEY,
	count      INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_at ON rate_limits (expires_at);

-- Payment ledger, keyed by Stripe event id so a redelivered webhook cannot grant twice.
-- Rows outlive the account on purpose: this is the record behind an invoice.
CREATE TABLE IF NOT EXISTS purchases (
	stripe_event_id TEXT PRIMARY KEY,
	user_id         TEXT,
	amount_cents    INTEGER NOT NULL,
	messages        INTEGER NOT NULL,
	invoice_number  TEXT,
	created_at      INTEGER NOT NULL
);
