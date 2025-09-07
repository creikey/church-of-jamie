# Church of Jamie

Welcome to the church of Jamie

# Technical details

React + Vite app deployed on Cloudflare Pages with Pages Functions at `/api` on the same domain. Local dev runs a single origin where `/` is the live-reload site and `/api` is served by the Worker.

## Prerequisites
- Node.js 20+ (22 recommended)
- Cloudflare account with Pages access
- GitHub repository (for CI optional)

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

## Project Layout
- `src/` – React app
- `functions/` – Cloudflare Pages Functions
  - `functions/api/index.ts` → GET `/api`
- `shared/` – Shared TypeScript types used by both client and worker
- `wrangler.toml` – Wrangler configuration for Pages

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

### Configure GitHub Secrets
- `CLOUDFLARE_API_TOKEN` – API token with Pages:Edit (or Pages:Write) permission
- `CLOUDFLARE_ACCOUNT_ID` – Your Cloudflare Account ID

## Scripts
- `npm run dev` – Start Vite and Wrangler together (single origin at 8788)
- `npm run build` – Type-check and build static assets to `dist/`
- `npm run preview` – Preview built site with Vite
- `npm run lint` – ESLint
- `npm run cf:login` – `wrangler login`