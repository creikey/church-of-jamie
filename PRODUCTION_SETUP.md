# Production Setup

Everything needed to take this from a clone to a live site that signs people in, answers
questions, and takes money. Follow it top to bottom — the order matters, because several steps
need a value produced by an earlier one.

Budget about an hour, most of which is waiting for DNS and filling in Stripe's business details.

**How to read this**

- Every step ends with a **✅ Check** — a command or a thing you should see. Do not move to the
  next step until it passes. That is the whole point of the ordering; a wrong value in step 5
  shows up as a confusing failure in step 19 otherwise.
- Replace `yourdomain.com` with your real domain and `church-of-jamie` with your real project name
  everywhere. If you pick a different project name, use it consistently — it appears in
  `wrangler.toml`, in every `--project-name` flag, and in the D1 commands.
- Anything in `<angle brackets>` is a value you paste in.

---

## What it costs

| Thing | Cost | Required? |
|---|---|---|
| Cloudflare Workers Paid | **$5 / month** | **Yes** — Email Sending needs it, and it lifts the 10 ms CPU cap that a cold start can exceed |
| Cloudflare Pages, D1, Turnstile | free at this scale | — |
| Cloudflare Email Sending | 3,000 emails/month included, then $0.35 per 1,000 | — |
| A domain | ~$10 / year | **Yes** — email cannot be sent without one |
| OpenRouter credit | ~$0.04 per question answered | **Yes** |
| Stripe | 2.9% + 30¢ per sale (~36¢ on $5) | **Yes** |

At $5 for 100 messages you are roughly at break-even on model cost. See *Running costs* in the
README before you decide that is the price you want.

## What you need before starting

- **Node.js 22** — `node --version`
- **A domain whose DNS is on Cloudflare.** Nameservers must point at Cloudflare, not just an
  A record. If the domain is registered elsewhere, add it at
  https://dash.cloudflare.com → **Add a domain** and change the nameservers at your registrar
  first. This can take a few hours to propagate; start it now if it is not done.
- **A Cloudflare account**, **a Stripe account**, and **an OpenRouter account**.
- The Discord export folder, if you are rebuilding the corpus (step 14).

> **One decision up front.** Steps 12 and 19 have you use Stripe **test mode**, so you can run the
> whole flow with a fake card before real money is involved. Step 22 is the switch to live. Do not
> skip ahead — the test keys and live keys have separate webhooks and separate signing secrets,
> and mixing them is the single most common way this breaks.

---

## 1. Install and log in

```bash
npm i
npx wrangler login
```

A browser opens; approve the access request.

**✅ Check**

```bash
npx wrangler whoami
```

Prints your email and a table containing your **Account ID**. Copy that ID somewhere — it is
`CLOUDFLARE_ACCOUNT_ID` and you will paste it twice.

## 2. Upgrade to Workers Paid

Email Sending will not work without it.

1. https://dash.cloudflare.com → **Compute** → **Workers & Pages**
2. **Plans** (left sidebar) → **Workers Paid** → subscribe ($5/month)

**✅ Check** — the Workers & Pages overview no longer shows "Free" next to your plan.

## 3. Create the D1 database

```bash
npx wrangler d1 create church-of-jamie
```

It prints a block like:

```toml
[[d1_databases]]
binding = "DB"
database_name = "church-of-jamie"
database_id = "b1e0f2a4-1234-4c5d-9e8f-0a1b2c3d4e5f"
```

Open `wrangler.toml` and replace the placeholder `database_id` with the real UUID. Leave `binding`
and `database_name` exactly as they are — the code looks up `env.DB` by that binding name.

**✅ Check**

```bash
grep database_id wrangler.toml
```

Shows a real UUID, **not** `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 4. Create the tables

Both databases — the local one is a separate sqlite file and does not inherit anything.

```bash
npm run db:local
npm run db:remote
```

**✅ Check**

```bash
npx wrangler d1 execute church-of-jamie --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Lists: `login_codes`, `purchases`, `rate_limits`, `sessions`, `users`.

> Re-run these two commands any time `schema.sql` changes. Every statement is `IF NOT EXISTS`, so
> it is safe to run repeatedly.

## 5. Turn on email sending for your domain

This is what mails the sign-in codes. Cloudflare writes the DNS records for you, which is the main
reason to use it over an outside provider.

1. https://dash.cloudflare.com → **Compute** → **Email Service** → **Email Sending**
2. **Onboard Domain**
3. Pick `yourdomain.com` from the list
4. Review the records it proposes — an **MX** on the `cf-bounce` subdomain, and **SPF**, **DKIM**
   and **DMARC** TXT records
5. **Done**

Records usually go live in 5–15 minutes for a domain already on Cloudflare DNS.

> **If your domain is not in the list**, its DNS is not on Cloudflare yet. Go back to *What you
> need before starting* and finish the nameserver change. Nothing else in this step will work
> until that is done.

> **If you already have an SPF record**, do not let this create a second one — a domain may only
> have one `v=spf1` TXT record, and two is worse than none. Merge Cloudflare's `include:` into the
> record you have.

**✅ Check** — the domain shows **Verified** (or **Active**) on the Email Sending page. Refresh
after a few minutes if it is still pending.

Now decide the address mail comes from. It must be on the onboarded domain:

```
EMAIL_FROM=Church of Jamie <jamie@yourdomain.com>
```

The mailbox does not have to exist — nothing is delivered to it. If you want replies to reach
you, set up **Email Routing** separately to forward that address to your inbox.

## 6. Create the email API token

Cloudflare tokens are scoped, so this is a second token, separate from the AI one in step 7.

1. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Create Custom Token**
2. Name: `Church of Jamie email`
3. Permissions — **one row**:
   - **Account** · **Email Sending** · **Edit**
   - Make sure the dropdown on the left says **Account**, not **Zone**. There are similarly named
     entries under Zone and they will not work.
4. Account Resources: your account
5. **Continue to summary** → **Create Token**
6. Copy it now — it is shown once → this is `CLOUDFLARE_EMAIL_TOKEN`

**✅ Check** — paste your account ID, token and from-address into this and run it. Send it to an
address you can actually read.

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/email/sending/send" \
  -H "Authorization: Bearer <CLOUDFLARE_EMAIL_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"from":"jamie@yourdomain.com","to":"you@wherever.com","subject":"test","text":"it works"}'
```

You want `"success": true`. **Do not continue until this works** — everything about signing in
depends on it, and debugging it here is far easier than debugging it through the app.

- `"code": 1000` / sender domain not verified → step 5 is not finished, or `from` is not on the
  onboarded domain.
- `Authentication error` → the token is wrong, or the permission was added under Zone instead of
  Account.
- `"success": true` but nothing arrives → check spam. If it is still missing after a few minutes,
  the DNS records from step 5 have not propagated.

> **New accounts have a low daily sending quota** that rises as Cloudflare sees healthy sending.
> It is plenty for launch, but if you expect a big first day, request an increase in advance.

## 7. Create the Workers AI token

Separate token, separate permission. This one turns questions into embeddings.

1. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Create Custom Token**
2. Name: `Church of Jamie AI`
3. Permissions — one row: **Account** · **Workers AI** · **Read**
4. Account Resources: your account
5. Create, copy → `CLOUDFLARE_AI_TOKEN`

**✅ Check** — you now have two different tokens saved, plus the account ID from step 1.

## 8. Get an OpenRouter key

This is what actually answers questions.

1. https://openrouter.ai/settings/keys → **Create Key**, copy it → `OPENROUTER_API_KEY`
2. https://openrouter.ai/settings/credits → add credit. **A key with no credit fails on the first
   question**, so put at least a few dollars on it.

**✅ Check** — the credits page shows a non-zero balance.

## 9. Create the Turnstile widget

This keeps the sign-in form off bots. Without it, anyone can make your site mail a code to any
address they like, which burns your quota and gets your domain blacklisted.

1. https://dash.cloudflare.com → **Turnstile** → **Add widget**
2. Name: `Church of Jamie`
3. Hostnames — add **all** of these:
   - `yourdomain.com`
   - `www.yourdomain.com` (if you will use it)
   - `church-of-jamie.pages.dev` (the Pages URL from step 15 — add it now, it is predictable)
   - `localhost`
4. Widget Mode: **Managed**
5. Create → copy **Site Key** → `TURNSTILE_SITE_KEY`, **Secret Key** → `TURNSTILE_SECRET_KEY`

**✅ Check** — you have two keys, and `localhost` is in the hostname list (step 16 needs it).

## 10. Get your Stripe test key

1. https://dashboard.stripe.com → make sure the **Test mode** toggle (top right) is **on**
2. **Developers** → **API keys**
3. Reveal and copy the **Secret key**, which starts `sk_test_` → `STRIPE_SECRET_KEY`

There is nothing else to create in Stripe. No Product, no Price — the checkout page is built from
the constants in `server/env.ts`.

**✅ Check** — your key starts with `sk_test_`, not `pk_` (that is the publishable key, which this
app does not use) and not `sk_live_`.

### A word on Managed Payments

Stripe turns **Managed Payments** on by default for new accounts, and this integration is written
for it. Stripe becomes the merchant of record: it registers for and remits VAT and sales tax in
75+ countries, fights disputes, and issues the invoice and its own confirmation email. That costs
[3.5% on top of standard processing](https://support.stripe.com/questions/managed-payments-pricing)
— a $5 sale pays 6.4% + 30¢ instead of 2.9% + 30¢, so you net $4.38 rather than $4.56.

Against roughly $4.00 of model cost per 100 messages, that is the difference between about 38¢ and
56¢ of margin. Worth knowing before you decide $5 is the price; see *Running costs* in the README.

**Nothing to do here** — it is already on and the code already matches it. If you would rather
have the 18¢ and handle tax registration yourself, turn it off under **Settings → Payments**, then
add `'invoice_creation[enabled]': 'true'` back to `createCheckoutSession` in `server/stripe.ts`.
Leaving that parameter in while Managed Payments is on is rejected with *"Unsupported parameter:
invoice_creation"* at the moment someone clicks Buy.

Buyers get two emails: Stripe's confirmation and ours. Turn Stripe's off under **Settings →
Customer emails** if one is enough.

## 11. Install the Stripe CLI

Needed to test payments locally, because the balance only moves when Stripe calls back.

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

(Not on a Mac: https://docs.stripe.com/stripe-cli)

**✅ Check** — `stripe --version` prints a version.

## 12. Write `.dev.vars`

```bash
cp .dev.vars.example .dev.vars
```

Then fill it in. `.dev.vars` is gitignored; never commit it.

```
OPENROUTER_API_KEY=sk-or-v1-...
CLOUDFLARE_ACCOUNT_ID=<from step 1>
CLOUDFLARE_AI_TOKEN=<from step 7>
CLOUDFLARE_EMAIL_TOKEN=<from step 6>
EMAIL_FROM=Church of Jamie <jamie@yourdomain.com>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=<step 13 fills this in>
TURNSTILE_SITE_KEY=<from step 9>
TURNSTILE_SECRET_KEY=<from step 9>
```

`ANTHROPIC_API_KEY` is only needed if you switch `MODEL` in `functions/api/ask.ts` to a Claude
model. Leave it out otherwise.

**✅ Check**

```bash
grep -c . .dev.vars
```

Nine or more non-empty lines, and no value still reads `...`.

## 13. Get the local webhook secret

In a terminal you will leave running:

```bash
stripe listen --forward-to localhost:8788/api/stripe-webhook
```

It prints `Your webhook signing secret is whsec_...`. Put that in `.dev.vars` as
`STRIPE_WEBHOOK_SECRET`.

> This secret is different from the production one you create in step 18. Leave `stripe listen`
> running for the whole of step 16.

**✅ Check** — `.dev.vars` has a `STRIPE_WEBHOOK_SECRET` starting `whsec_`.

## 14. Build the corpus

Skip this if `public/corpus/` already has four files in it.

```bash
npm run convert -- /path/to/discord-export-folder
export $(grep -v '^#' .dev.vars | grep -E '^CLOUDFLARE_(ACCOUNT_ID|AI_TOKEN)' | xargs) && npm run embed
```

Takes a couple of minutes.

**✅ Check**

```bash
ls public/corpus/
```

Shows `corpus.bin`, `meta.json`, `source.txt`, `vectors.bin`.

## 15. Test the whole thing locally

In a second terminal (leave `stripe listen` running in the first):

```bash
npm run dev
```

Open http://localhost:8788 and walk the entire path:

1. Enter your real email address. The Turnstile checkbox must appear and go green — if it does
   not, `localhost` is missing from the widget's hostnames (step 9).
2. **Send code**. The email arrives within a few seconds.
3. Type the six digits. You are signed in, and the bar reads **10 left**.
4. Ask a question. The counter drops to **9** and an answer streams in. *(The first question is
   slow — the worker is pulling the corpus into memory.)*
5. Click **Buy 100 · $5.00**. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC, any
   postcode.
6. You land back on the site and the counter climbs to **109** within a few seconds. A receipt
   email arrives with a link to a Stripe invoice.
7. **Delete** → **Delete forever**. You are back at the sign-in panel.

**✅ Check** — all seven worked. If step 6's counter never moved, look at the `stripe listen`
terminal: it prints every event it forwarded and the status it got back. A `400` there means
`STRIPE_WEBHOOK_SECRET` does not match; re-copy it from step 13 and **restart `npm run dev`** —
wrangler only reads `.dev.vars` at startup.

Stop `npm run dev` and `stripe listen` when you are done.

## 16. Create the Pages project and deploy

```bash
npm run build
npx wrangler pages project create church-of-jamie --production-branch main
npx wrangler pages deploy dist --project-name church-of-jamie
```

This publishes `dist/` **and** `functions/` to the same domain. There is no separate API deploy.

It prints a URL like `https://church-of-jamie.pages.dev`.

**✅ Check** — open the URL. The page loads, with the sign-in panel at the bottom. Nothing will
work yet; the secrets come next.

## 17. Set the production secrets

Production does **not** read `.dev.vars`. Each command prompts for a value and stores it
encrypted; you only do this once, and redeploys keep them.

```bash
npx wrangler pages secret put OPENROUTER_API_KEY     --project-name church-of-jamie
npx wrangler pages secret put CLOUDFLARE_ACCOUNT_ID  --project-name church-of-jamie
npx wrangler pages secret put CLOUDFLARE_AI_TOKEN    --project-name church-of-jamie
npx wrangler pages secret put CLOUDFLARE_EMAIL_TOKEN --project-name church-of-jamie
npx wrangler pages secret put EMAIL_FROM             --project-name church-of-jamie
npx wrangler pages secret put STRIPE_SECRET_KEY      --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SITE_KEY     --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SECRET_KEY   --project-name church-of-jamie
```

`STRIPE_WEBHOOK_SECRET` is deliberately missing — it comes in step 18, because it does not exist
until the endpoint does.

**✅ Check**

```bash
curl -s https://church-of-jamie.pages.dev/api/me
```

Returns `"turnstileSiteKey":"0x4AAA..."` — a real key, **not `null`**. `null` means Turnstile is
off and your sign-in form is open to scripts.

**✅ Check the database is attached** — https://dash.cloudflare.com → **Workers & Pages** →
`church-of-jamie` → **Settings** → **Bindings**. There should be a **D1 database** binding named
`DB` pointing at `church-of-jamie`. If it is missing, add it by hand and redeploy.

## 18. Create the production Stripe webhook

**This is the step that actually gives people their messages.** Coming back from Checkout proves
nothing; the balance only moves when Stripe calls this endpoint. Skip it and people pay and get
nothing.

1. https://dashboard.stripe.com/webhooks — **Test mode** still on
2. **Add endpoint**
3. Endpoint URL: `https://church-of-jamie.pages.dev/api/stripe-webhook`
   (use your custom domain instead if you did step 19 first)
4. **Select events** → search `checkout.session.completed` → tick **only** that one
5. **Add endpoint**
6. On the endpoint's page, **Signing secret** → **Reveal** → copy the `whsec_...`

```bash
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name church-of-jamie
```

**✅ Check** — on the Stripe webhook page, **Send test webhook** → `checkout.session.completed`.
The attempt should come back **200**. (It will say it was ignored in the response body, because
the fake event has no user attached — 200 is the thing to look for.)

## 19. Attach your custom domain (optional)

1. https://dash.cloudflare.com → **Workers & Pages** → `church-of-jamie` → **Custom domains**
2. **Set up a domain** → `yourdomain.com` (or a subdomain) → follow the prompt

Cloudflare adds the DNS record itself.

**If you do this, go back and update:**
- The Stripe webhook URL (step 18) to the new domain
- The Turnstile hostnames (step 9) to include it

**✅ Check** — `curl -s https://yourdomain.com/api/me` returns the same JSON as the pages.dev URL.

## 20. Full production smoke test

Do exactly what you did in step 15, but on the live URL, still with the test card. Use a
**different email address** from the one in step 15 so you get a clean new account.

**✅ Check** — all seven steps pass, on the real domain.

## 21. Go live

Everything so far has been Stripe test mode. To take real money:

1. Complete Stripe's activation form (business details, bank account) if you have not.
2. Turn the **Test mode** toggle **off**.
3. **Developers** → **API keys** → copy the live **Secret key** (`sk_live_...`):
   ```bash
   npx wrangler pages secret put STRIPE_SECRET_KEY --project-name church-of-jamie
   ```
4. **Developers** → **Webhooks** → **Add endpoint** again, in live mode this time. Same URL, same
   single event. Copy the **live** signing secret:
   ```bash
   npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name church-of-jamie
   ```

   The live endpoint and its secret are entirely separate from the test ones. This is the step
   people forget, and the symptom is that payments succeed while nobody's balance moves.

5. Buy once with a real card to confirm. Refund it from the Stripe dashboard afterwards if you
   like — but note a refund does **not** take the messages back.

**✅ Final checklist**

```bash
curl -s https://yourdomain.com/api/me
```

- [ ] `turnstileSiteKey` is a real key, not `null`
- [ ] `pricing` reads `{"messages":100,"priceCents":500}`
- [ ] A live-mode Stripe webhook exists, pointing at `/api/stripe-webhook`, subscribed to
      `checkout.session.completed` only
- [ ] Its **live** signing secret is set as `STRIPE_WEBHOOK_SECRET`
- [ ] Sending a code to a fresh address works on the live domain
- [ ] A real £/$5 purchase credits 100 messages and mails a receipt

---

## Every secret, in one table

| Name | Where it comes from | Step |
|---|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys | 8 |
| `CLOUDFLARE_ACCOUNT_ID` | `npx wrangler whoami` | 1 |
| `CLOUDFLARE_AI_TOKEN` | API token, Account · Workers AI · Read | 7 |
| `CLOUDFLARE_EMAIL_TOKEN` | API token, Account · Email Sending · Edit | 6 |
| `EMAIL_FROM` | an address on your onboarded domain | 5 |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | 10 / 21 |
| `STRIPE_WEBHOOK_SECRET` | the webhook endpoint's signing secret | 13 / 18 / 21 |
| `TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → your widget | 9 |
| `TURNSTILE_SECRET_KEY` | same widget | 9 |
| `ANTHROPIC_API_KEY` | only if `MODEL` points at a Claude model | — |

Not a secret, and not set this way: `database_id` in `wrangler.toml` (step 3). It ships with the
deploy.

## Changing the offer

All three numbers live in `server/env.ts`:

```ts
export const FREE_MESSAGES = 10;
export const MESSAGES_PER_PURCHASE = 100;
export const PURCHASE_PRICE_CENTS = 500;
```

Edit, `npm run build`, redeploy. Nothing in Stripe needs touching — the checkout page is built
from these on every purchase.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `RESEND_API_KEY is not set` | stale build | this project uses Cloudflare email now; `npm run build` and redeploy |
| `CLOUDFLARE_EMAIL_TOKEN, EMAIL_FROM is not set on this deployment` | secrets missing in production | step 17 |
| `the sending domain is not verified` | domain not onboarded, or `EMAIL_FROM` is on a different domain | step 5 |
| `CLOUDFLARE_EMAIL_TOKEN was rejected` | permission added under Zone instead of Account | step 6 |
| Code email never arrives | DNS not propagated, or in spam | re-run the ✅ Check in step 6 |
| Turnstile box never appears | hostname not on the widget | step 9 |
| `That challenge did not pass` every time | site key and secret key are from different widgets | step 9 |
| `/api/me` shows `"turnstileSiteKey":null` | one of the two keys is unset in production | step 17 |
| Paid, but the counter never moves | no webhook, wrong URL, or wrong signing secret | step 18; check the attempt log on Stripe's webhook page |
| Webhook attempts show `400 Stripe signature does not match` | test secret on a live endpoint, or vice versa | step 21 |
| `Unsupported parameter: invoice_creation` when clicking Buy | Managed Payments is on and `invoice_creation` was added back | remove it from `createCheckoutSession`, or turn Managed Payments off — step 10 |
| `D1_ERROR: no such table: users` | schema not applied to the remote database | `npm run db:remote` |
| `Cannot read properties of undefined (reading 'prepare')` | the `DB` binding is missing | step 17's second ✅ Check |
| `Corpus asset /corpus/meta.json is not being served` | corpus not built, or not in `dist/` | step 14, then `npm run build` |
| Answers fail with an OpenRouter 402 | no credit on the key | step 8 |
| Local changes to `.dev.vars` do nothing | wrangler reads it at startup | restart `npm run dev` |

## Deploying again later

```bash
npm run build
npx wrangler pages deploy dist --project-name church-of-jamie
```

Secrets, the database, and its contents all survive. You only revisit the steps above if you
change `schema.sql` (re-run step 4) or rebuild the corpus (step 14).
