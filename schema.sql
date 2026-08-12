-- D1 schema for accounts, sign-in codes, sessions, and the limit counters.
--
-- Apply it with:
--   npx wrangler d1 execute church-of-jamie --local --file=./schema.sql   (local dev)
--   npx wrangler d1 execute church-of-jamie --remote --file=./schema.sql  (production)
--
-- Every statement is idempotent, so re-running it after a schema change is safe.

-- One row per account. An account is an address and nothing else: the daily message allowance is
-- counted per address in `rate_limits`, not stored here.
CREATE TABLE IF NOT EXISTS users (
	id         TEXT PRIMARY KEY,
	email      TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL
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

-- Fixed-window counters behind every abuse limit, and behind the daily message allowance itself.
-- `bucket` already encodes the window, so an expired row is simply never read again —
-- `sweepExpired` in server/ratelimit.ts clears them out.
CREATE TABLE IF NOT EXISTS rate_limits (
	bucket     TEXT PRIMARY KEY,
	count      INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_at ON rate_limits (expires_at);

-- Databases created before payments were removed still carry the balance column and the payment
-- ledger. Neither is read any more, and `CREATE TABLE IF NOT EXISTS` above will not clear them.
-- Run these once against such a database to be rid of them:
--
--   ALTER TABLE users DROP COLUMN messages_remaining;
--   DROP TABLE IF EXISTS purchases;
