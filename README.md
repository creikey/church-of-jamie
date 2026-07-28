# Church of Jamie

Welcome to the church of Jamie.

Ask a question about self-realization and get an answer written as Jamie, grounded in his own
writing and in how he actually answered similar questions in the Discord.

Asking requires an account. Signing in with an email address grants **10 messages**; after that,
**$5 buys 100 more**. An account holds an email address and a number, and nothing else.

# Technical details

React + Vite app deployed on Cloudflare Pages with Pages Functions at `/api` on the same domain.
Local dev runs a single origin where `/` is the live-reload site and `/api` is served by the Worker.

## Prerequisites
- Node.js 20+ (22 recommended)
- Cloudflare account with Pages access
- OpenRouter account (or an Anthropic one, if you switch `MODEL` back to Claude)
- Cloudflare **Workers Paid** plan ($5/month) — Email Sending requires it, and it lifts the 10 ms
  CPU cap that a cold start can exceed
- A domain on Cloudflare DNS, for sending the sign-in code and receipt emails
- Stripe account, for payments
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
- `src/` – React app (the "ask Jamie" page, plus the sign-in and account panels)
- `functions/` – Cloudflare Pages Functions, one file per route
  - `functions/api/index.ts` → GET `/api`
  - `functions/api/ask.ts` → POST `/api/ask` — retrieval + the model, streamed back as SSE
  - `functions/api/me.ts` → GET `/api/me` — the signed-in account, and what a purchase costs
  - `functions/api/auth/request-code.ts` → POST — mail a six-digit sign-in code
  - `functions/api/auth/verify.ts` → POST — trade the code for a session cookie
  - `functions/api/auth/logout.ts` → POST — drop the session
  - `functions/api/account.ts` → DELETE `/api/account` — erase the account
  - `functions/api/checkout.ts` → POST — open a Stripe Checkout page
  - `functions/api/stripe-webhook.ts` → POST — the only place a balance goes up
- `server/` – Worker-side modules the routes share: `accounts.ts` (sessions, codes, balances),
  `stripe.ts`, `email.ts`, `turnstile.ts`, `ratelimit.ts`, and `env.ts` (every binding and secret,
  plus the pricing and abuse-limit constants)
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
secrets for production in step 6.

| Secret | Where it comes from | Needed for |
|---|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys | answering questions (default model) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | answering questions, only if `MODEL` is a Claude model |
| `CLOUDFLARE_ACCOUNT_ID` | `npx wrangler whoami` | embeddings |
| `CLOUDFLARE_AI_TOKEN` | Cloudflare API token, Workers AI · Read | embeddings |
| `CLOUDFLARE_EMAIL_TOKEN` | API token, Account · Email Sending · Edit | sign-in codes and receipts |
| `EMAIL_FROM` | your verified sending address | sign-in codes and receipts |
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/apikeys | payments |
| `STRIPE_WEBHOOK_SECRET` | the webhook endpoint you create in step 3 | payments |
| `TURNSTILE_SITE_KEY` | Cloudflare dashboard → Turnstile | keeping the sign-in form off bots |
| `TURNSTILE_SECRET_KEY` | same widget | keeping the sign-in form off bots |

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

### Cloudflare Email Sending — this is what sends the sign-in codes and receipts

Both emails are plain text: the six digits someone types in to sign in, and the receipt after a
purchase, which links to the Stripe invoice when there is one.

Sending goes through **Cloudflare Email Service**, over its REST API rather than the `send_email`
Worker binding. Two reasons, and both are hard blockers rather than preferences: Pages Functions
do not support that binding, and the binding can only reach addresses already verified as Email
Routing destinations — which is useless for mailing a code to someone who has just typed their
address in for the first time. A token and a `fetch` reach anybody.

It needs the **Workers Paid** plan and a domain whose DNS is on Cloudflare. In exchange,
Cloudflare writes the SPF, DKIM, DMARC and bounce-MX records itself, which is the part that is
fiddly with any outside provider.

1. Dashboard → **Compute** → **Email Service** → **Email Sending** → **Onboard Domain**
2. Pick your domain, review the records it proposes, **Done**. Live in 5–15 minutes.
3. Dashboard → **My Profile** → **API Tokens** → **Create Custom Token**, one permission:
   **Account** · **Email Sending** · **Edit**. (Account, not Zone — there is a similarly named
   Zone entry that will not work.) → `CLOUDFLARE_EMAIL_TOKEN=...`
4. `EMAIL_FROM=Church of Jamie <jamie@yourdomain.com>` — must be on the onboarded domain. A bare
   `jamie@yourdomain.com` works too; the display name is optional. The mailbox does not have to
   exist, since nothing is delivered to it.

`CLOUDFLARE_ACCOUNT_ID` is reused from above. New accounts start with a conservative daily sending
quota that rises with healthy use.

[PRODUCTION_SETUP.md](PRODUCTION_SETUP.md) has a `curl` that verifies this end to end before you
wire it into anything.

Swapping to another provider is one file: `server/email.ts` exposes `sendEmail`, and nothing else
knows how mail is sent.

### Stripe secret key — this is what takes the money

1. Sign up at https://dashboard.stripe.com.
2. **Developers → API keys**. There are two modes, toggled top-right:
   - **Test mode** gives `sk_test_...`. Use this locally. Card `4242 4242 4242 4242`, any future
     expiry, any CVC, pays without charging anything.
   - **Live mode** gives `sk_live_...`, and needs the business details Stripe asks for during
     activation before it will work. Use this in production.
3. Reveal and copy the **Secret key** → `STRIPE_SECRET_KEY=sk_test_...`

There is nothing to create in the Stripe dashboard beyond this — no Product, no Price. The
checkout page is built from the constants in `server/env.ts`:

```ts
export const FREE_MESSAGES = 10;
export const MESSAGES_PER_PURCHASE = 100;
export const PURCHASE_PRICE_CENTS = 500;
```

Changing what a sign-in grants, or what $5 buys, is a change to those three lines.

`STRIPE_WEBHOOK_SECRET` comes from step 3, once there is an endpoint to point at.

### Turnstile keys — this is what keeps the sign-in form off bots

`/api/auth/request-code` sends mail to an address nobody has proved they own, which makes it the
one endpoint worth attacking. Turnstile is what stops that being automated. **Do not deploy
without it** — see *Abuse and rate limiting* below for what it is holding back.

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
nothing configured. `/api/me` reports which state it is in, and the sign-in panel follows.

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

Accounts, sessions and the payment ledger live in Cloudflare D1. `schema.sql` has the tables.

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
npx wrangler d1 execute church-of-jamie --remote --command "SELECT email, messages_remaining FROM users"
```

## 3. Point Stripe at the webhook

**This is the step that actually gives someone their messages.** Nothing is granted when the
browser comes back from Checkout — that proves nothing. The balance moves only when Stripe calls
`/api/stripe-webhook`, and that callback is verified against `STRIPE_WEBHOOK_SECRET`. Without
this step, people can pay and get nothing.

### Locally

```bash
brew install stripe/stripe-cli/stripe        # or see https://docs.stripe.com/stripe-cli
stripe login
stripe listen --forward-to localhost:8788/api/stripe-webhook
```

`stripe listen` prints `Your webhook signing secret is whsec_...`. Put that in `.dev.vars` as
`STRIPE_WEBHOOK_SECRET` and restart `npm run dev`. Leave `stripe listen` running while you test.

### In production

1. https://dashboard.stripe.com/webhooks → **Add endpoint**
2. Endpoint URL: `https://your-domain.example/api/stripe-webhook`
3. Events to send: **`checkout.session.completed`** — that one, nothing else
4. Add endpoint, then **Reveal** the **Signing secret** → `STRIPE_WEBHOOK_SECRET=whsec_...`

Do this once in test mode and again in live mode; they are separate endpoints with separate
secrets, and the live secret is the one that belongs with `sk_live_...`.

Redeliveries are expected and harmless: the event id is the primary key of the `purchases` table,
so a repeated delivery is recorded as already applied and grants nothing a second time.

## 4. Build the corpus

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

## 5. Try it locally

```bash
npm run dev                                                # terminal 1
stripe listen --forward-to localhost:8788/api/stripe-webhook   # terminal 2
```

Open http://localhost:8788. The whole path, end to end:

1. Enter your email, click **Send code**. The code arrives by mail; type it in. You are signed in
   with 10 messages.
2. Ask something. The counter drops to 9. The first question is slow (the worker pulls the corpus
   into memory); after that it is fast for as long as the isolate lives.
3. Click **Buy 100 · $5.00**, pay with `4242 4242 4242 4242`, any future expiry, any CVC.
4. You land back on the site, it waits for the webhook, and the counter jumps to 109. A receipt
   arrives with a link to the Stripe invoice.
5. **Delete** → **Delete forever** erases the account.

If the counter does not move after paying, `stripe listen` is the first place to look — it prints
every forwarded event and the status it got back.

## 6. Deploy

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
npx wrangler pages secret put CLOUDFLARE_EMAIL_TOKEN --project-name church-of-jamie
npx wrangler pages secret put EMAIL_FROM --project-name church-of-jamie
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name church-of-jamie
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SITE_KEY --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name church-of-jamie
```

(Use `ANTHROPIC_API_KEY` instead of `OPENROUTER_API_KEY` if `MODEL` points at a Claude model. Use
the `sk_live_...` key and the *live* webhook's signing secret here, not the test ones.)

Each command prompts for the value and stores it encrypted. Do this once; redeploys keep them.

The D1 binding is not a secret and is not set this way — it comes from `wrangler.toml`, so make
sure the real `database_id` is in there before deploying. Confirm it landed under **Workers &
Pages → church-of-jamie → Settings → Bindings**; if the binding is missing there, add `DB` →
`church-of-jamie` by hand and redeploy.

`wrangler pages deploy` publishes `dist/` **and** `functions/` to the same domain — there is no
separate step for the API.

### Once it is live

- **Check `curl https://your-domain/api/me` reports a non-null `turnstileSiteKey`.** If it is
  null, the challenge is off and the sign-in form is open to scripts.
- Set the webhook endpoint URL in Stripe to the real domain (step 3), not a preview URL.
- Add the real hostname to the Turnstile widget's allowed hostnames, or the widget will not render
  there.
- Send yourself a code on the live site to confirm mail is delivering from the onboarded domain.
- Buy once with a real card to confirm the live keys work end to end. Refund it from the Stripe
  dashboard afterwards if you like — note that a refund does **not** take the messages back; that
  is not wired up.

---

# Accounts and payments

## How signing in works

There is no password and no sign-up form. Both are the same flow:

1. `POST /api/auth/request-code` mints a six-digit code, stores its SHA-256 hash against the
   address, and mails the plaintext once. One outstanding code per address — asking again replaces
   the old one, which is what invalidates it.
2. `POST /api/auth/verify` compares hashes. On a match the code row is deleted, the account is
   created if it did not exist (with `FREE_MESSAGES` on it), and a session cookie is set.

Codes last 10 minutes and die after 5 wrong guesses. A Turnstile challenge, and a stack of rate
limits, sit in front of step 1 — see *Abuse and rate limiting* below, which is where the reasoning
for each of them is. `/api/auth/request-code` answers the same way whether or not the address has
an account, so it cannot be used to find out who has one.

Sessions are 32 random bytes in an `HttpOnly; SameSite=Lax` cookie, good for 90 days. Only the
hash is stored, so a leaked copy of the `sessions` table cannot be used to sign in as anyone.
`Secure` is set on https and omitted on `http://localhost`, where the browser would drop it.

## How a message gets spent

`/api/ask` refuses anyone without a session (401). With one, it decrements before doing any work:

```sql
UPDATE users SET messages_remaining = messages_remaining - 1 WHERE id = ? AND messages_remaining > 0
```

Zero rows changed means the balance was empty, and the request is refused with 402. Doing it in
one conditional statement is what stops two questions sent at the same moment from both seeing the
last message and both spending it. If the answer then fails before a single word is emitted, the
message is put back; a stream that breaks part-way through stays paid for, because an answer was
given. The new balance is streamed to the browser as a `balance` event ahead of the text, so the
counter in the header settles immediately rather than after the model finishes.

## How a purchase works

`POST /api/checkout` opens a Stripe Checkout Session carrying the account id in
`client_reference_id` and `metadata.user_id`, and returns its URL for the browser to follow.

Nothing is granted there. Coming back to `success_url` proves nothing, so the site simply polls
`/api/me` until the number goes up. The grant happens in `/api/stripe-webhook`, which:

1. verifies the `Stripe-Signature` HMAC against the raw request bytes and rejects anything signed
   more than five minutes ago, so a captured callback cannot be replayed;
2. inserts the event id into `purchases` — losing that insert means this is a redelivery, and it
   stops there;
3. adds the messages, then mails a plain-text receipt, linking to the invoice when there is one.

A receipt that fails to send is logged and swallowed. The messages are already on the account, and
asking Stripe to retry would only re-run a grant that has happened. The invoice lookup is
best-effort for the same reason: money has changed hands, so a receipt goes out whether or not the
invoice can be read.

### Managed Payments

Stripe enables **Managed Payments** on new accounts by default, and this integration assumes it.
Under it Stripe is the merchant of record — it registers for and remits VAT and sales tax in 75+
countries, fights disputes, and owns everything after the sale, including the invoice and its own
confirmation email. It costs
[3.5% on top of standard processing](https://support.stripe.com/questions/managed-payments-pricing),
so a $5 sale pays 6.4% + 30¢ rather than 2.9% + 30¢ — about 18¢ more.

That is why `createCheckoutSession` sends no `invoice_creation`: with Managed Payments on, Stripe
rejects it outright, because it is asking to do a job Stripe has taken. Invoices still exist; they
are just Stripe's to make.

To go the other way — keep the 18¢, take on the tax registration yourself — turn Managed Payments
off under **Settings → Payments** in the dashboard (or pass `managed_payments[enabled]: 'false'` on
that call) and add `'invoice_creation[enabled]': 'true'` back in `server/stripe.ts`.

Buyers get two emails either way: Stripe's confirmation and ours. Stripe's can be turned off under
**Settings → Customer emails**.

Refunds are not wired up: refunding in the Stripe dashboard returns the money and leaves the
messages on the account.

## Abuse and rate limiting

Three things here cost real money or real goodwill, so those are what is defended: **sending mail
to strangers**, **giving away free messages**, and **model calls**. Everything else follows from
those.

### The mail cannon

`/api/auth/request-code` will mail a six-digit code to any address it is given. A script walking a
list turns this site into a spam source, burns the monthly send quota, and gets the sending domain
blacklisted. The per-address cooldown does nothing about it, because every request in that attack
uses a different address.

So, in order: **Turnstile**, then a **per-IP limit**, then per-address limits. The challenge is
first so that a person who solves it is never spending budget a bot already used up.

### Every limit

All of them live in `LIMITS` in `server/env.ts`, counted in D1 by `server/ratelimit.ts`. Fixed
windows, so someone timing it right gets up to twice the number across a boundary — that is fine
for what these defend.

| Limit | Value | Stops |
|---|---|---|
| Codes per IP | 10 / hour | mass mailing from one place |
| Codes per address | 5 / hour, 15 / day | mail-bombing one person |
| Cooldown between codes | 45 seconds | double-clicking the button |
| Guesses per code | 5, then the code dies | brute-forcing one code |
| Verify attempts per IP | 20 / hour | brute-forcing across many addresses |
| New accounts per IP | 5 / day | farming free messages |
| Checkout pages per IP | 20 / hour | noise |

### What a six-digit code is actually worth

The code limits and the five-guess cap together cap an attacker at 15 codes × 5 guesses = **75
attempts a day** against one address, out of a million. That is roughly a **2.7% chance over a
year** of continuous attack — during which the victim is receiving fifteen unexplained sign-in
emails a day, every day, and the prize is an account holding ten messages.

That is the trade a six-digit code makes, and it is the right one here. If you want it gone,
change the code length in `issueLoginCode` (`server/accounts.ts`) to eight digits and the odds
drop by a factor of a hundred, at the cost of two more keystrokes.

### The rest of it

- **Free messages are the real spend.** Every new account is `FREE_MESSAGES` × ~$0.04 given away.
  Turnstile plus 5 signups per IP per day is what stands between a script and the bill. If it ever
  gets abused anyway, lowering `FREE_MESSAGES` is the lever.
- **Paid messages need no limit.** They cost money to obtain, which is the limit.
- **History is clipped.** The browser holds the conversation and hands it back with every
  question, so an attacker controls it too. Each turn is checked for shape and clipped to
  `MAX_QUESTION_CHARS`, and only the last `MAX_HISTORY_MESSAGES` are kept — otherwise one
  message's worth of balance buys an arbitrarily large prompt.
- **Cross-origin writes are refused.** The session cookie is `SameSite=Lax`, which is what
  actually stops another site from riding it; every state-changing endpoint also checks `Origin`
  as a second lock.
- **The webhook is the exception**, since Stripe sends no `Origin`. It is protected by the
  signature instead, and refuses a body over 256 KB before computing the HMAC over it.
- **Codes and sessions are stored hashed**, so a leaked copy of either table is not usable.
- **`/api/auth/request-code` answers identically** whether or not the address has an account, so
  it cannot be used to find out who has one.
- **Expired rows are swept** — codes, sessions, rate-limit windows — on a small fraction of
  requests, since there is no cron in a Pages Function.

### Not covered

- **A distributed attacker with many IPs** gets a proportional multiple of the per-IP limits. Add
  a Cloudflare WAF rate-limiting rule on `/api/auth/*` if that ever shows up; it acts at the edge,
  before any of this code runs.
- **Disposable-address services** work fine for collecting free messages. Blocking them is an
  arms race that is not worth entering at ten messages a head.
- **Refunds do not claw back messages.** Someone can pay, use the messages, and charge back.
  Stripe Radar is the place to deal with that if it happens.

## What an account stores

An id, an email address, a number, and a creation timestamp. That is the whole of the `users`
table. There is no history, no profile, and the conversation itself never leaves `localStorage` in
the browser.

`DELETE /api/account` erases the user row, every session, and any outstanding sign-in code, and
clears the cookie. Rows in `purchases` stay, with `user_id` set to NULL — they are the record
behind an invoice, and Stripe holds the same payments regardless, but they no longer point at
anybody. Any remaining messages are forfeited, which the confirmation says before you click it.

## Running costs

Measured on a real question: the system prompt is ~19.5k tokens (the philosophy text) and the
retrieved exchanges are ~13k, so about **32k input tokens per question**. On Inkling through
OpenRouter ($1/M in, $4.05/M out) that is roughly **$0.04** per question. On Claude Opus 5 it was
roughly **$0.18** cold or **$0.09** with the prompt cache warm — that caching only applies on the
Anthropic path, where the system prompt is sent as a cacheable block. Workers AI embeddings are
effectively free at this volume. Cloudflare's free plan caps Pages Functions CPU at 10ms per request, which the first
request after a cold start can exceed; the $5 Workers Paid plan removes that limit — and is
required anyway, since Email Sending only runs on it.

So $5 for 100 messages is roughly **$4 of model cost** at the Inkling price. What is left after
Stripe depends on whether Managed Payments is on:

| | Stripe takes | You net | Margin over $4 of model cost |
|---|---|---|---|
| Managed Payments on (the default, and what this is built for) | 6.4% + 30¢ | $4.38 | **38¢** |
| Managed Payments off | 2.9% + 30¢ | $4.56 | **56¢** |

Either way it is close to break-even, and it is underwater on Claude Opus — one Opus answer costs
more than a hundredth of the pack. The three numbers that fix that are `PURCHASE_PRICE_CENTS`,
`MESSAGES_PER_PURCHASE` and `FREE_MESSAGES` in `server/env.ts`; raising the price or cutting the
free allowance moves the margin far more than the 18¢ Managed Payments costs.

D1 and email are effectively free at this scale: D1's free tier covers 5M row reads a day, and the
Workers Paid plan includes 3,000 emails a month (then $0.35 per 1,000) — at roughly two emails per
paying customer, that is a lot of customers.

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

0. Requires a session and takes one message off the balance — see *Accounts and payments* above.
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
