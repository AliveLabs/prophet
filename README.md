# Ticket

Ticket is a competitive-intelligence tool for restaurant operators. Each location gets a periodic
**brief**: a small, ranked set of grounded, actionable "plays" synthesized from the signals around that
restaurant — reviews, local events, weather, foot traffic, competitor menus + social, and local search
visibility. The product promise is *intelligence without execution*: it tells the operator the smartest
move and why, but never acts on their behalf.

Codename **Prophet / Vatic** (repo `AliveLabs/prophet`). Built by [Alive Labs](https://alivelabs.io).

## How it works (engine, high level)

1. **Dossier** (`lib/insights/dossier`) — one structured context object per (location, day): all signals
   + ~76 deterministic rule outputs (the grounded evidence layer a play may cite).
2. **Producer skills** (`lib/skills/*`) — expert lenses (reputation, positioning, convergence,
   food-pairing, social-counter, local-demand, grassroots, …) each reason over the same dossier.
3. **Synthesis → presenter → voice** (`lib/skills/pipeline.ts`) — rank/select the plays, compose the
   evidence-forward presentation layer, then scrub to Ticket's voice. Anti-fabrication is enforced
   throughout (`lib/eval/checks.ts`): grounded refs, verbatim quotes, no POS/$ claims.
4. **Persist + serve** — the brief is precomputed (cron/queue) and stored, so the app render path is a
   plain DB read.

## Tech stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript** · **Tailwind CSS 4**
- **Supabase** (Postgres + auth + storage; service-role for the precompute jobs)
- **Stripe** (subscriptions / trials) · **PostHog** (analytics)
- Background work: a durable `signal_jobs` queue + Vercel cron (`app/api/cron/*`)
- Tests: **Vitest** (unit) · **Playwright** (e2e)
- Hosted on **Vercel** (production deploys from `main`).

## Local development

```bash
npm install
# Pull env vars from Vercel (or copy .env.local). Requires Supabase + Stripe + provider keys.
vercel env pull .env.local
npm run dev          # http://localhost:3000
```

## Scripts

```bash
npm run test:unit    # vitest (the fast gate — run this before every commit)
npm run test:e2e     # playwright
npm run build        # next build
npm run lint         # eslint
```

Verify gate before any deploy: `npx tsc --noEmit` + `npm run test:unit` + `npm run build`.

## Ops tooling (`scripts/db`)

- `npx tsx scripts/db/sql.mts --query "…"` — run SQL / apply a migration via the Supabase Management
  API (refuses DROP/TRUNCATE without `--allow-destructive`).
- `npx tsx scripts/db/cron.mts <name> [--param k=v]` — trigger a prod cron endpoint with `CRON_SECRET`
  (e.g. `build-brief --param location_id=<id>` to rebuild one location's brief).

## Docs

Architecture and plans live in [`docs/`](docs/) — start with `docs/BLUEPRINT.md`, the
`docs/engine-rewrite/*` plans, and `docs/SESSION-HANDOFF.md` / `docs/PRIMARY-WORKLIST.md` for current state.
