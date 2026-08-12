# Production Setup

Everything needed to take this from a clone to a live site that answers questions. Follow it top
to bottom — the order matters, because several steps need a value produced by an earlier one.

Budget about twenty minutes.

**How to read this**

- Every step ends with a **✅ Check** — a command or a thing you should see. Do not move to the
  next step until it passes. That is the whole point of the ordering; a wrong value in step 8
  shows up as a confusing failure in step 12 otherwise.
- Replace `yourdomain.com` with your real domain and `church-of-jamie` with your real project name
  everywhere. If you pick a different project name, use it consistently — it appears in
  `wrangler.toml`, in every `--project-name` flag, and in the D1 commands.
- Anything in `<angle brackets>` is a value you paste in.

---

## What it costs

| Thing | Cost | Required? |
|---|---|---|
| Cloudflare Workers Paid | **$5 / month** | Recommended — it lifts the 10 ms CPU cap that a cold start can exceed |
| Cloudflare Pages, D1, Turnstile | free at this scale | — |
| A domain | ~$10 / year | No — the free `pages.dev` URL works |
| OpenRouter credit | ~$0.04 per question answered | **Yes** |

Nothing is charged for: passing the challenge is worth **10 messages**, free, and passing another
one is worth ten more. At ~$0.04 a question that is about **$0.40 per solved challenge**, and
there is no cap above that — Turnstile decides how many challenges anyone gets to pass. **Put a
spend limit on the OpenRouter key** (step 6) before you put this in front of anyone, and read
*Abuse* in the README for the reasoning.

## What you need before starting

- **Node.js 22** — `node --version`
- **A Cloudflare account** and **an OpenRouter account**.
- A domain, only if you want one — step 13 is optional and the `pages.dev` URL works without it.
- The Discord export folder, if you are rebuilding the corpus (step 9).

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

Optional, and worth the $5. The free plan caps Pages Functions at 10 ms of CPU per request, which
the first question after a cold start can exceed — the symptom is an occasional "Exceeded CPU
limit" on an otherwise correct deployment.

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

Lists: `grants`. That is the only table.

> Re-run these two commands any time `schema.sql` changes. Every statement is `IF NOT EXISTS`, so
> it is safe to run repeatedly.

## 5. Create the Workers AI token

This one turns questions into embeddings.

1. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Create Custom Token**
2. Name: `Church of Jamie AI`
3. Permissions — one row: **Account** · **Workers AI** · **Read**
4. Account Resources: your account
5. Create, copy → `CLOUDFLARE_AI_TOKEN`

**✅ Check** — you have the token saved, plus the account ID from step 1.

## 6. Get an OpenRouter key

This is what actually answers questions.

1. https://openrouter.ai/settings/keys → **Create Key**, copy it → `OPENROUTER_API_KEY`
2. https://openrouter.ai/settings/credits → add credit. **A key with no credit fails on the first
   question**, so put at least a few dollars on it.
3. Set a **spend limit** on the key while you are there. Nothing in this app caps total spend —
   the challenge is what makes messages cost something to get, and this is what makes the worst
   case survivable.

**✅ Check** — the credits page shows a non-zero balance, and the key shows a limit.

## 7. Create the Turnstile widget

This is what buys messages, and the **only** thing standing between a script and your model bill —
there are no rate limits behind it on purpose. Without it, anything that can send a POST can help
itself to ten messages at a time, in a loop.

1. https://dash.cloudflare.com → **Turnstile** → **Add widget**
2. Name: `Church of Jamie`
3. Hostnames — add **all** of these:
   - `yourdomain.com`
   - `www.yourdomain.com` (if you will use it)
   - `church-of-jamie.pages.dev` (the Pages URL from step 11 — add it now, it is predictable)
   - `localhost`
4. Widget Mode: **Managed**
5. Create → copy **Site Key** → `TURNSTILE_SITE_KEY`, **Secret Key** → `TURNSTILE_SECRET_KEY`

**✅ Check** — you have both keys, and `localhost` is in the hostname list (step 10 needs it).

## 8. Write `.dev.vars`

```bash
cp .dev.vars.example .dev.vars
```

Then fill it in. `.dev.vars` is gitignored; never commit it.

```
OPENROUTER_API_KEY=sk-or-v1-...
CLOUDFLARE_ACCOUNT_ID=<from step 1>
CLOUDFLARE_AI_TOKEN=<from step 5>
TURNSTILE_SITE_KEY=<from step 7>
TURNSTILE_SECRET_KEY=<from step 7>
```

`ANTHROPIC_API_KEY` is only needed if you switch `MODEL` in `functions/api/ask.ts` to a Claude
model. Leave it out otherwise.

**✅ Check**

```bash
grep -c . .dev.vars
```

Five or more non-empty lines, and no value still reads `...`.

## 9. Build the corpus

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

## 10. Test the whole thing locally

```bash
npm run dev
```

Open http://localhost:8788 and walk the entire path:

1. The Turnstile checkbox must appear and go green — if it does not, `localhost` is missing from
   the widget's hostnames (step 7). The composer replaces it, and the bar reads **10 of 10
   messages left**.
2. Ask a question. The counter drops to **9 of 10** and an answer streams in. *(The first question
   is slow — the worker is pulling the corpus into memory.)*
3. Spend all ten. The composer is replaced by the challenge again, which now says another ten are
   a checkbox away. Pass it, and the bar reads **10 of 10** once more.

**✅ Check** — all three worked. If the counter never moves, the grant in D1 is the place to look:

```bash
npx wrangler d1 execute church-of-jamie --local --command "SELECT * FROM grants"
```

Clearing the `coj_messages` cookie in devtools puts you back at a first visit. Stop `npm run dev`
when you are done.

## 11. Create the Pages project and deploy

```bash
npm run build
npx wrangler pages project create church-of-jamie --production-branch main
npx wrangler pages deploy dist --project-name church-of-jamie
```

This publishes `dist/` **and** `functions/` to the same domain. There is no separate API deploy.

It prints a URL like `https://church-of-jamie.pages.dev`.

**✅ Check** — open the URL. The page loads, with the challenge at the bottom. Nothing will work
yet; the secrets come next.

## 12. Set the production secrets

Production does **not** read `.dev.vars`. Each command prompts for a value and stores it
encrypted; you only do this once, and redeploys keep them.

```bash
npx wrangler pages secret put OPENROUTER_API_KEY     --project-name church-of-jamie
npx wrangler pages secret put CLOUDFLARE_ACCOUNT_ID  --project-name church-of-jamie
npx wrangler pages secret put CLOUDFLARE_AI_TOKEN    --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SITE_KEY     --project-name church-of-jamie
npx wrangler pages secret put TURNSTILE_SECRET_KEY   --project-name church-of-jamie
```

**✅ Check**

```bash
curl -s https://church-of-jamie.pages.dev/api/me
```

Returns `"turnstileSiteKey":"0x4AAA..."` — a real key, **not `null`**. `null` means Turnstile is
off, and anything that can POST to `/api/challenge` can spend your OpenRouter credit.

**✅ Check the database is attached** — https://dash.cloudflare.com → **Workers & Pages** →
`church-of-jamie` → **Settings** → **Bindings**. There should be a **D1 database** binding named
`DB` pointing at `church-of-jamie`. If it is missing, add it by hand and redeploy.

## 13. Attach your custom domain (optional)

1. https://dash.cloudflare.com → **Workers & Pages** → `church-of-jamie` → **Custom domains**
2. **Set up a domain** → `yourdomain.com` (or a subdomain) → follow the prompt

Cloudflare adds the DNS record itself.

**If you do this, go back and update the Turnstile hostnames (step 7) to include it.**

**✅ Check** — `curl -s https://yourdomain.com/api/me` returns the same JSON as the pages.dev URL.

## 14. Full production smoke test

Do exactly what you did in step 10, but on the live URL. Use a private window so you arrive
without the grant cookie your local run left behind.

**✅ Check** — all three steps pass, on the real domain.

**✅ Final checklist**

```bash
curl -s https://yourdomain.com/api/me
```

- [ ] `turnstileSiteKey` is a real key, not `null`
- [ ] `messagesPerChallenge` reads `10`
- [ ] The challenge passes on the live domain, and `messagesRemaining` goes from `0` to `10`
- [ ] The first question answers, and the bar reads **9 of 10 messages left** afterwards

---

## Every secret, in one table

| Name | Where it comes from | Step |
|---|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys | 6 |
| `CLOUDFLARE_ACCOUNT_ID` | `npx wrangler whoami` | 1 |
| `CLOUDFLARE_AI_TOKEN` | API token, Account · Workers AI · Read | 5 |
| `TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → your widget | 7 |
| `TURNSTILE_SECRET_KEY` | same widget | 7 |
| `ANTHROPIC_API_KEY` | only if `MODEL` points at a Claude model | — |

Not a secret, and not set this way: `database_id` in `wrangler.toml` (step 3). It ships with the
deploy.

## Changing the allowance

One number, in `server/env.ts`:

```ts
export const MESSAGES_PER_CHALLENGE = 10;
```

Edit, `npm run build`, redeploy. It takes effect on the next challenge anyone passes; grants
already handed out keep whatever is left on them until they are spent or topped up.

The copy follows it on its own — the challenge panel and the counter read the number from
`/api/me` rather than hard-coding it, so there is nothing else to edit.

That is the only lever in the code. How *many* challenges anyone gets to pass is Turnstile's
call — raise the widget mode, or add a Cloudflare WAF rate-limiting rule on `/api/challenge`, if
it ever needs a hard ceiling. Both live in the dashboard, and both act before this code runs.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Turnstile box never appears | hostname not on the widget | step 7 |
| `That challenge did not pass` every time | site key and secret key are from different widgets | step 7 |
| `/api/me` shows `"turnstileSiteKey":null` | one of the two keys is unset in production | step 12 |
| `That is all 10 messages` sooner than expected | the grant is per browser, and a shared browser shares it | expected; pass the challenge again for ten more |
| `D1_ERROR: no such table: grants` | schema not applied to the remote database | `npm run db:remote` |
| `Cannot read properties of undefined (reading 'prepare')` | the `DB` binding is missing | step 12's second ✅ Check |
| `Corpus asset /corpus/meta.json is not being served` | corpus not built, or not in `dist/` | step 9, then `npm run build` |
| Answers fail with an OpenRouter 402 | no credit on the key | step 6 |
| Local changes to `.dev.vars` do nothing | wrangler reads it at startup | restart `npm run dev` |

## Deploying again later

```bash
npm run build
npx wrangler pages deploy dist --project-name church-of-jamie
```

Secrets, the database, and its contents all survive. You only revisit the steps above if you
change `schema.sql` (re-run step 4) or rebuild the corpus (step 9).
