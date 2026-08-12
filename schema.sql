-- D1 schema. One table: the message grants.
--
-- Apply it with:
--   npx wrangler d1 execute church-of-jamie --local --file=./schema.sql   (local dev)
--   npx wrangler d1 execute church-of-jamie --remote --file=./schema.sql  (production)
--
-- Every statement is idempotent, so re-running it after a schema change is safe.

-- One row per browser that has passed a Turnstile challenge. The row is the whole entitlement:
-- `remaining` messages, counting down, refilled by passing another challenge. Nothing identifies
-- the person — `token_hash` is the SHA-256 of the opaque cookie the challenge issued, so a copy
-- of this table cannot be turned back into a working cookie.
--
-- Expired rows are cleared by `sweepExpiredGrants` in server/grants.ts, which rides along on a
-- small fraction of requests since there is no cron in a Pages Function.
CREATE TABLE IF NOT EXISTS grants (
	token_hash TEXT PRIMARY KEY,
	remaining  INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS grants_expires_at ON grants (expires_at);

-- Databases created before email accounts and per-IP rate limiting were removed still carry the
-- tables behind them, and `CREATE TABLE IF NOT EXISTS` above will not clear them. Run these once
-- against such a database to be rid of them:
--
--   DROP TABLE IF EXISTS rate_limits;
--   DROP TABLE IF EXISTS sessions;
--   DROP TABLE IF EXISTS login_codes;
--   DROP TABLE IF EXISTS users;
--   DROP TABLE IF EXISTS purchases;
