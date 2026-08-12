# Church of Jamie

Welcome to the church of Jamie.

Ask a question about self-realization and get an answer written as Jamie, grounded in his own
writing and in how he actually answered similar questions in the Discord.

Asking is free and there is nothing to sign in to. Passing a "prove you are human" checkbox is
worth **10 messages**; when those are spent, pass another one for 10 more. There is no account and
no address — nothing is stored about anybody.

# Technical details

React + Vite app deployed on Cloudflare Pages with Pages Functions at `/api` on the same domain.
Local dev runs a single origin where `/` is the live-reload site and `/api` is served by the Worker.

## Prerequisites
- Node.js 20+ (22 recommended)
- Cloudflare account with Pages access
- OpenRouter account (or an Anthropic one, if you switch `MODEL` back to Claude)
- Cloudflare **Workers Paid** plan ($5/month), recommended — it lifts the 10 ms CPU cap that a
  cold start can exceed
- GitHub repository (for CI optional)

> **Setting this up for the first time?** [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md) is the
> step-by-step version of everything below, in the order that works, with a check after each step.
> This file is the reference; that one is the walkthrough.

## Install
```bash
npm i
```

## Local Development
Runs Vite and Cloudflare Pages Functions together on one origin.

```bash
npm run dev
```
- App: http://localhost:8788/
- API: http://localhost:8788/api

Notes
- Vite runs on port 5173 (strict) and is proxied by Wrangler to 8788.
- The Worker types reuse shared interfaces in `shared/`.
- `/api/ask` needs the secrets in `.dev.vars` and a built corpus — see below.
- `npm run dev` builds first on purpose. Wrangler serves static assets out of `dist/`, and the
  worker reads the corpus from there, so a stale `dist/` means `/api/ask` cannot find the corpus.
- Use **http://localhost:5173** for hot reload while editing the UI (it proxies `/api` to 8788);
  8788 serves the last build.
- Wrangler reads `.dev.vars` and `wrangler.toml` at startup only. After changing either, restart
  `npm run dev` or the endpoints will keep seeing the old values.
- The local database is a sqlite file under `.wrangler/`, created by the `d1 execute --local` step
  in setup. It survives restarts and is independent of production.

## Project Layout
- `src/` – React app (the "ask Jamie" page, plus the challenge panel)
- `functions/` – Cloudflare Pages Functions, one file per route
  - `functions/api/index.ts` → GET `/api`
  - `functions/api/ask.ts` → POST `/api/ask` — retrieval + the model, streamed back as SSE
  - `functions/api/me.ts` → GET `/api/me` — messages left, and whether a challenge is configured
  - `functions/api/challenge.ts` → POST `/api/challenge` — a solved challenge, traded for messages
- `server/` – Worker-side modules the routes share: `grants.ts` (the allowance and the cookie that
  carries it), `turnstile.ts`, and `env.ts` (every binding and secret, plus
  `MESSAGES_PER_CHALLENGE`)
- `shared/` – Shared TypeScript types used by both client and worker
- `schema.sql` – The D1 tables
- `tools/` – Offline scripts: `convert.ts` (Discord export → `converted.json`) and `embed.ts`
  (`converted.json` → `public/corpus/`)
- `public/corpus/` – Generated RAG corpus, fetched by the worker at runtime
- `wrangler.toml` – Wrangler configuration for Pages, including the D1 binding

---

# Setting it up from scratch

Four things have to happen once: get the keys, create the database, build the corpus, deploy.

**Every secret, in one list.** Each one is explained below. All of them go in `.dev.vars` for
local development (copy `.dev.vars.example`; `.dev.vars` is gitignored) and are set again as Pages
secrets for production in step 5.

| Secret | Where it comes from | Needed for |
|---|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys | answering questions (default model) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | answering questions, only if `MODEL` is a Claude model |
| `CLOUDFLARE_ACCOUNT_ID` | `npx wrangler whoami` | embeddings |
| `CLOUDFLARE_AI_TOKEN` | Cloudflare API token, Workers AI · Read | embeddings |
| `TURNSTILE_SITE_KEY` | Cloudflare dashboard → Turnstile | the challenge that hands out messages |
| `TURNSTILE_SECRET_KEY` | same widget | the challenge that hands out messages |

Plus one thing that is **not** a secret: `database_id` in `wrangler.toml`, from step 2.

## 1. The keys

Only the key for the active model provider has to be set. Every endpoint fails fast, naming
exactly which variable is missing, so a half-configured deployment says so rather than misbehaving.

### OpenRouter API key — this is what answers questions

The answering model is set by the `MODEL` constant in `functions/api/ask.ts`, and it defaults to
Thinking Machines Inkling through OpenRouter.

1. Go to https://openrouter.ai/settings/keys
2. Create Key, copy it (it is shown once), and add credit at
   https://openrouter.ai/settings/credits if the account has none.
3. `OPENROUTER_API_KEY=sk-or-v1-...`

### Anthropic API key — only if you switch `MODEL` to a Claude model

1. Go to https://console.anthropic.com/settings/keys
2. Create Key, copy it (it is shown once), and add billing credit if the account has none.
3. `ANTHROPIC_API_KEY=sk-ant-...`

Only the key for the active provider has to be set; the endpoint fails fast with a clear message
if it is missing.

### Cloudflare API token — this is what turns text into embeddings

Embeddings come from Cloudflare Workers AI, both when building the corpus and when a visitor
asks a question, so the same token is used in both places.

1. Go to https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Create Custom Token**
2. Name it "Church of Jamie AI"
3. Permissions: **Account → Workers AI → Read** (that one row is all it needs)
4. Account Resources: your account
5. Create, copy the token → `CLOUDFLARE_AI_TOKEN=...`

You also need the account ID it belongs to:

```bash
npx wrangler login     # opens a browser, one time
npx wrangler whoami    # prints your account ID
```

→ `CLOUDFLARE_ACCOUNT_ID=...`

### Turnstile keys — this is what stands between a script and the model bill

A passed challenge is what buys messages here, and it is the only thing anyone has to do to get
them. Take it away and `/api/challenge` hands out model time to anything that can send a POST.
**Do not deploy without it** — see *Abuse* below for what it is holding back.

1. https://dash.cloudflare.com → **Turnstile** → **Add widget**
2. Name it, add your hostname (and `localhost` if you want the real widget locally)
3. Widget mode **Managed** is the right default
4. Create, then copy both: **Site Key** → `TURNSTILE_SITE_KEY`, **Secret Key** →
   `TURNSTILE_SECRET_KEY`

It is free at any volume. For local development you can skip the widget and use Cloudflare's test
pair, which always passes:

```
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

With either key missing the challenge is not drawn and not checked, so `npm run dev` works with
nothing configured — the panel shows a plain **Begin** button instead. `/api/me` reports which
state it is in, and the panel follows.

## 1b. Choosing the model

`functions/api/ask.ts` keeps every model it knows how to call in one table, and one line picks the
active one:

```ts
const MODELS: Record<string, ModelChoice> = {
	inkling: { provider: 'openrouter', id: 'thinkingmachines/inkling' },
	opus: { provider: 'anthropic', id: 'claude-opus-5' },
	sonnet: { provider: 'anthropic', id: 'claude-sonnet-5' },
};

/** Which model answers. Flip this one line to switch. */
const MODEL = MODELS.inkling;
```

Change `MODELS.inkling` to `MODELS.opus` to go back to Claude. To use a different OpenRouter model,
add a row with its slug from https://openrouter.ai/models — `provider: 'openrouter'` routes through
OpenRouter's OpenAI-compatible endpoint, `provider: 'anthropic'` uses the Anthropic SDK directly
(which is also what gets prompt caching on the system prompt).

## 2. Create the database

The message grants live in Cloudflare D1. `schema.sql` has the one table.

```bash
npx wrangler login                        # opens a browser, one time
npx wrangler d1 create church-of-jamie
```

That prints a `database_id`. Put it in `wrangler.toml`, replacing the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "church-of-jamie"
database_id = "the-uuid-it-printed"
```

Then create the tables, in both places:

```bash
npx wrangler d1 execute church-of-jamie --local  --file=./schema.sql   # local dev
npx wrangler d1 execute church-of-jamie --remote --file=./schema.sql   # production
```

Every statement is `IF NOT EXISTS`, so re-running it after a schema change is safe. The local
database is a sqlite file under `.wrangler/` and has nothing to do with the remote one.

To look inside later:

```bash
npx wrangler d1 execute church-of-jamie --remote --command \
  "SELECT COUNT(*) AS grants, SUM(remaining) AS unspent FROM grants"
```

There is nothing else in there to look at — a grant row is a hash, a number and an expiry.

## 3. Build the corpus

```bash
npm run convert -- /path/to/discord-export-folder    # → converted.json
npm run embed                                        # → public/corpus/
```

`embed` reads `converted.json` and `self-realization-complete.txt`, embeds every exchange through
Workers AI, and writes four files into `public/corpus/`. It takes a couple of minutes and reads
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_AI_TOKEN` from the environment — if they live in `.dev.vars`,
export them for the run:

```bash
export $(grep -v '^#' .dev.vars | xargs) && npm run embed
```

Use `npm run embed -- --dry-run` to see what would be embedded without spending Workers AI
neurons. Re-run `embed` whenever `converted.json` or the philosophy text changes.

## 4. Try it locally

```bash
npm run dev
```

Open http://localhost:8788. The whole path, end to end:

1. The challenge passes itself (with the test keys it always does) and 10 of 10 messages are
   yours. With no Turnstile keys set, click **Begin** instead.
2. Ask something. The counter drops to 9. The first question is slow (the worker pulls the corpus
   into memory); after that it is fast for as long as the isolate lives.
3. Spend all ten and the composer is replaced by the challenge again. Passing it puts the count
   back to 10.

The allowance is one row in D1:

```bash
npx wrangler d1 execute church-of-jamie --local --command "SELECT * FROM grants"
```

Clearing the `coj_messages` cookie in devtools is the quickest way back to a first visit.

## 5. Deploy

```bash
npx wrangler pages project create church-of-jamie --production-branch main   # first time only
npm run build
npx wrangler pages deploy dist --project-name church-of-jamie
```

Then set the secrets on the deployed project — production does **not** read `.dev.vars`:

```bash
npx wrangler pages secret put OPENROUTER_API_KEY --project-name church-of-jamie
npx wrangler pages secret put CLOUDFLARE_ACCOUNT_ID --project-name church-of-jamie
npx wrangler pages secret put CLOUDFLARE_AI_TOKEN --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SITE_KEY --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name church-of-jamie
```

(Use `ANTHROPIC_API_KEY` instead of `OPENROUTER_API_KEY` if `MODEL` points at a Claude model.)

Each command prompts for the value and stores it encrypted. Do this once; redeploys keep them.

The D1 binding is not a secret and is not set this way — it comes from `wrangler.toml`, so make
sure the real `database_id` is in there before deploying. Confirm it landed under **Workers &
Pages → church-of-jamie → Settings → Bindings**; if the binding is missing there, add `DB` →
`church-of-jamie` by hand and redeploy.

`wrangler pages deploy` publishes `dist/` **and** `functions/` to the same domain — there is no
separate step for the API.

### Once it is live

- **Check `curl https://your-domain/api/me` reports a non-null `turnstileSiteKey`.** If it is
  null, the challenge is off and anything that can POST can help itself to model time.
- Add the real hostname to the Turnstile widget's allowed hostnames, or the widget will not render
  there.
- Ask one question to confirm the model key works, and check the counter drops to 9 of 10.

---

# Messages, and what stands in front of them

## How you get messages

There is no account, no address, no password and nothing to sign in to. Passing a Turnstile
challenge is the whole of the entitlement:

1. `POST /api/challenge` with the widget's token. The token is verified with Cloudflare, and
   `MESSAGES_PER_CHALLENGE` messages — **10**, set in `server/env.ts` — are put on a grant.
2. The grant is 32 random bytes in an `HttpOnly; SameSite=Lax` cookie, good for 30 days. Only its
   SHA-256 hash reaches D1, so a leaked copy of the `grants` table cannot be turned back into a
   working cookie. `Secure` is set on https and omitted on `http://localhost`, where the browser
   would drop it.
3. Spend all ten and the composer is replaced by the challenge again. Passing it fills the same
   grant back up.

A grant row is the whole story: a hash, a number, and an expiry.

```sql
CREATE TABLE grants (
	token_hash TEXT PRIMARY KEY,
	remaining  INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);
```

**Refilling tops up rather than stacks.** A browser that already has a grant keeps its token and
has `remaining` raised to ten, not raised *by* ten:

```sql
INSERT INTO grants (token_hash, remaining, expires_at) VALUES (?, 10, ?)
ON CONFLICT(token_hash) DO UPDATE SET
  remaining = MAX(grants.remaining, excluded.remaining),
  expires_at = excluded.expires_at
RETURNING remaining
```

Which is the point: solving challenges in bulk buys nothing, because ten of them are worth the
same ten messages as one. Somebody who wants more has to arrive as a new browser and pass a fresh
challenge for every ten messages.

## How a message gets spent

`/api/ask` refuses anyone without a grant (**401**), and spends before doing any work:

```sql
UPDATE grants SET remaining = remaining - 1
WHERE token_hash = ? AND remaining > 0 AND expires_at > ?
RETURNING remaining
```

No row back means the grant is spent, and the request is refused with **429** and a message saying
another challenge is worth another ten. Decrementing and reading in one statement is what stops
two questions sent at the same moment from both seeing the last message and both spending it, and
the `remaining > 0` guard is what makes the second one fail rather than go negative.

If the answer then fails before a single word is emitted, the message is put back; a stream that
breaks part-way through stays spent, because an answer was given. What is left is streamed to the
browser as a `balance` event ahead of the text, so the counter settles immediately rather than
after the model finishes.

## Abuse

One thing here costs real money — **model time** — and it is given away, so that is what is
defended. Exactly one thing defends it: **the challenge**.

Without it, `/api/challenge` is a faucet — a script POSTs in a loop, collects a fresh cookie with
ten messages each time, and the only thing slowing it down is how fast it can open connections.
With it, every ten messages costs a solved challenge.

**There are no per-IP counters, and nothing about a visitor is stored.** That is a deliberate
deletion, not an omission. Turnstile already decides how hard a given visitor has to work and how
often, using signals — browser fingerprint, behaviour, reputation, Cloudflare's view of the whole
network — that a fixed-window counter in D1 cannot see. Counting requests per IP on top of that is
a worse copy of a job already being done, and it is the part that would have needed to remember
people.

The trade is honest: with no counter, the ceiling on what one attacker can spend is *however many
challenges Cloudflare will let them pass*, not a number written in this repository. Two levers
move it, and neither is application code:

- **Turnstile's widget mode.** **Managed** is the default and adapts per visitor. Raising it is
  the first response if abuse ever starts.
- **A Cloudflare WAF rate-limiting rule on `/api/challenge`.** Configured in the dashboard, it
  runs at the edge before any of this code does, and it is the right place for a hard cap because
  it costs nothing to serve a request it blocks.

`MESSAGES_PER_CHALLENGE` in `server/env.ts` is the one number here that moves the bill: it decides
what a single solved challenge is worth.

### The rest of it

- **History is clipped.** The browser holds the conversation and hands it back with every
  question, so an attacker controls it too. Each turn is checked for shape and clipped to
  `MAX_QUESTION_CHARS`, and only the last `MAX_HISTORY_MESSAGES` are kept — otherwise one message
  of the allowance buys an arbitrarily large prompt.
- **Cross-origin writes are refused.** The grant cookie is `SameSite=Lax`, which is what actually
  stops another site from riding it; `/api/ask` and `/api/challenge` also check `Origin` as a
  second lock.
- **Grant tokens are stored hashed**, so a leaked copy of the table is not usable.
- **Turnstile failing open.** If Cloudflare's verify endpoint is unreachable, `verifyTurnstile`
  logs and lets the request through rather than locking everyone out. Nothing else is checking, so
  that outage is genuinely open — the trade is that a Cloudflare outage does not also take the
  site down.
- **Expired grants are swept** on a small fraction of requests, since there is no cron in a Pages
  Function.

### Not covered

- **Nothing here caps total spend.** Every message given away is a solved challenge, but the
  number of challenges is Cloudflare's call, not this code's. Watch the OpenRouter balance rather
  than trusting a number in this repository, and put a spend limit on the key.
- **Commercial CAPTCHA solvers** cost real money per solve, which is most of why the challenge
  works at all — but they exist. Turnstile's widget mode and a WAF rule are the responses, both in
  the dashboard.

## What is stored

The SHA-256 of a cookie, a number of messages left, and an expiry. That is the whole of the
`grants` table. There is no address, no account, no profile, no history — and the conversation
itself never leaves `localStorage` in the browser.

Clearing the cookie is all "starting over" means, and it costs a challenge.

## Running costs

Measured on a real question: the system prompt is ~19.5k tokens (the philosophy text) and the
retrieved exchanges are ~13k, so about **32k input tokens per question**. On Inkling through
OpenRouter ($1/M in, $4.05/M out) that is roughly **$0.04** per question. On Claude Opus 5 it was
roughly **$0.18** cold or **$0.09** with the prompt cache warm — that caching only applies on the
Anthropic path, where the system prompt is sent as a cacheable block. Workers AI embeddings are
effectively free at this volume. Cloudflare's free plan caps Pages Functions CPU at 10ms per
request, which the first request after a cold start can exceed; the $5 Workers Paid plan removes
that limit.

Nothing is charged for, so all of that is spend. What one passed challenge is worth:

| | Per question | One challenge (10 messages) |
|---|---|---|
| OpenRouter (the default) | ~$0.04 | **~$0.40** |
| Claude Opus 5, cache warm | ~$0.09 | **~$0.90** |

There is no cap above that — see *Abuse* — so the thing to size is the spend limit on the
OpenRouter key, not a constant in this repository. `MESSAGES_PER_CHALLENGE` in `server/env.ts`
halves or doubles what each solved challenge costs; a cheaper `MODEL` moves the per-question
figure instead.

D1 is effectively free at this scale: the free tier covers 5M row reads a day, and a question is a
couple of them.

## A note on what is public

Everything in `public/corpus/` is served as a static file, so the pseudonymized message corpus and
the philosophy text are fetchable by anyone who visits the site. That is fine for public Discord
content but worth knowing before pointing this at anything private.

---

## Corpus conversion (`convert`)

Turns a folder of [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) JSON
exports into one flat, pseudo-anonymized message array.

```bash
npm run convert -- /path/to/discord-export-folder
```

Flags: `--out <path>` (default `converted.json`, gitignored), `--jamie <id|username>` (default
`jamie0773`), `--compact` (no pretty-printing).

Each element is:

```json
{
  "disciple_index": 0,
  "timestamp": "2023-07-14T09:43:12.350Z",
  "message": "Howdy partners...",
  "message_uuid": "2f737ce7-...",
  "reply_to_uuid": "b1e031ec-..."
}
```

- `disciple_index` is `0` for Jamie and a stable `1..N` for everyone else, assigned in order of
  first appearance. Inline `@mentions` are rewritten to `Jamie` / `Disciple #N` to match.
- `reply_to_uuid` is present only when the replied-to message is also in the export.
- `message_uuid` is a UUIDv5 of the discord message id, so re-running is idempotent.
- Ordering: standalone channel messages are chronological, while each thread is emitted as a
  single contiguous block placed at the time the thread *began*. A thread that starts before a
  channel message therefore emits all of its replies before it, however long the thread ran.
- Attachments, embeds, stickers, reactions and system messages (joins, pins, renames) are
  dropped; this corpus is text.

## Corpus embedding (`embed`)

```bash
npm run embed -- [--in converted.json] [--source self-realization-complete.txt] [--dry-run]
```

One *exchange* is emitted per Jamie message: his message plus the conversation that led to it
(what he replied to, and the messages immediately before his turn). The embedding covers the whole
exchange, so a visitor's question retrieves the moment someone asked him something similar rather
than a sentence that merely shares vocabulary. Consecutive Jamie messages are grouped, so a run of
replies is stitched back into one answer instead of occupying ten retrieval slots.

Writes into `public/corpus/`:

| File | What it is |
|---|---|
| `meta.json` | model, dimensions, and the per-exchange group / date / byte-offset tables |
| `vectors.bin` | Float32 unit vectors, one row per exchange |
| `corpus.bin` | UTF-8 exchange text, sliced on demand so the worker never parses it whole |
| `source.txt` | the philosophy text the worker puts in the system prompt |

## How `/api/ask` answers

0. Requires a grant with a message left on it, and counts that message before any work is done —
   see *Messages, and what stands in front of them* above.
1. Embeds the question with the model recorded in `meta.json` (so query and corpus can never drift
   apart).
2. Cosine-ranks every exchange, collapses groups, keeps the top 10.
3. Calls the model named by `MODEL` with a system prompt of the persona instructions plus the
   entire `self-realization-complete.txt`, and a user turn carrying the retrieved exchanges
   followed by the question. On the Anthropic path the system prompt is sent as two blocks with the
   philosophy text marked cacheable; on the OpenRouter path it is one system string.
4. Streams text deltas back to the browser as SSE.

The browser keeps the conversation in `localStorage`, so it survives reloads; **New question**
clears it.

---

## How to deploy to production
1) Login
```bash
npx wrangler login
```

2) Create Cloudflare Pages project (choose the name you want)
```bash
npx wrangler pages project create church-of-jamie --production-branch main
```
- You can list projects to confirm:
```bash
npx wrangler pages project list
```

## Build
```bash
npm run build
```
- Output goes to `dist/`

## Manual Publish from CLI (optional)
```bash
npx wrangler pages deploy dist --project-name church-of-jamie
```
- This deploys the static site from `dist/` and also deploys Pages Functions from `functions/` automatically to the same domain. No extra step is needed for the API.

## GitHub Actions: Manual Deploy Workflow
A workflow is provided at `.github/workflows/deploy.yml` that builds and deploys both the static site and functions.

Note: CI builds from the repository, so `public/corpus/` must be committed for a CI deploy to
include the corpus (`converted.json` and the raw Discord export stay out of the repo).

### Configure GitHub Secrets
- `CLOUDFLARE_API_TOKEN` – API token with Pages:Edit (or Pages:Write) permission
- `CLOUDFLARE_ACCOUNT_ID` – Your Cloudflare Account ID

### Create the API token (minimal permissions)
1. Dashboard → profile menu (top right) → My Profile → API Tokens → Create Token → Create Custom Token.
2. Name it e.g. "Church of Jamie deploy".
3. Permissions:
   - Account → Cloudflare Pages: Edit
   - (No other permissions are needed for Pages deploys.)
4. Account resources: select your Cloudflare account.
5. Create token. Copy it and save in the GitHub repo as secret `CLOUDFLARE_API_TOKEN`.

### Find your Cloudflare Account ID
You can use CLI or the Dashboard:

- CLI:
  ```bash
  npx wrangler whoami
  ```
  After login, it prints your Account ID; use that for `CLOUDFLARE_ACCOUNT_ID`.

- Dashboard:
  1) Open `https://dash.cloudflare.com/` and select your account.
  2) Go to Workers & Pages → Overview. In Account details, click "Copy account ID".
  (Alternatively, from Accounts list, use the ⋯ menu → Copy account ID.)

## Scripts
- `npm run dev` – Start Vite and Wrangler together (single origin at 8788)
- `npm run convert` – Discord export → `converted.json`
- `npm run embed` – `converted.json` → `public/corpus/`
- `npm run build` – Type-check and build static assets to `dist/`
- `npm run db:local` – Apply `schema.sql` to the local D1 database
- `npm run db:remote` – Apply `schema.sql` to the production D1 database
- `npm run preview` – Preview built site with Vite
- `npm run lint` – ESLint
- `npm run cf:login` – `wrangler login`

`npm run build` type-checks four projects: `src/` (the app), `functions/` + `server/` (the
Worker), `tools/`, and the Vite config. The Worker code did not use to be checked at all; it is
now, under `tsconfig.functions.json` with Cloudflare's globals and no DOM.
