# Stripe Production — Configuration & Operations Guide

**Audience:** anyone who needs to take Stripe live for Ticket / Neat (or any future brand), debug a production payment issue, or hand off the system.

**Last updated:** 2026-04-26

This document covers, end-to-end, every piece of configuration required to run real money through the platform — Stripe, Supabase, Vercel, Resend, and the local repo — plus a runbook of common operational tasks.

If you only have time to read one section, read **§3 Pre-launch checklist**.

---

## Table of contents

1. [Architecture in one diagram](#1-architecture-in-one-diagram)
2. [Repo entrypoints (where the code lives)](#2-repo-entrypoints)
3. [Pre-launch checklist (read this)](#3-pre-launch-checklist)
4. [Environment variables — every value, what it is, where it lives](#4-environment-variables)
5. [Stripe Dashboard configuration](#5-stripe-dashboard-configuration)
6. [Supabase configuration](#6-supabase-configuration)
7. [Vercel configuration](#7-vercel-configuration)
8. [Resend configuration](#8-resend-configuration)
9. [Webhook configuration & event flow](#9-webhook-configuration--event-flow)
10. [Cron jobs (trial reminders)](#10-cron-jobs)
11. [End-to-end testing in TEST mode](#11-end-to-end-testing-in-test-mode)
12. [Going live (cutover runbook)](#12-going-live-runbook)
13. [Operational runbook](#13-operational-runbook)
14. [Adding a new brand or tier](#14-adding-a-new-brand-or-tier)
15. [Security model & PCI scope](#15-security-model--pci-scope)
16. [Monitoring, alerting, and dashboards](#16-monitoring-alerting-and-dashboards)
17. [Glossary & reference](#17-glossary--reference)

---

## 1. Architecture in one diagram

```text
┌───────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  thevatic.com     │       │  Stripe (LIVE)       │       │  Supabase (prod)     │
│  Next.js on       │       │  Account: Alive Labs │       │  Project: triodvds…  │
│  Vercel           │       │                      │       │                      │
│                   │       │  • 6 Products        │       │  • organizations     │
│  /settings/       │──────▶│  • 12 Prices         │       │    .stripe_customer_id
│   billing         │  POST │  • 2 Portal configs  │       │    .stripe_subscription_id
│                   │       │  • 1 Webhook ep      │       │    .subscription_tier
│  POST             │◀──────│                      │       │    .payment_state    │
│  /api/stripe/     │  302  └──────────┬───────────┘       │    .stripe_price_id  │
│   checkout        │                  │                   │    .trial_ends_at    │
│  POST             │                  │ Webhooks          │    .current_period_end
│  /api/stripe/     │                  │ (signed)          │  • stripe_webhook_   │
│   portal          │                  ▼                   │    events (idempotency
│  POST             │       ┌──────────────────────┐       │  • trial_reminder_   │
│  /api/stripe/     │◀──────│ /api/stripe/webhook  │──────▶│    sends             │
│   webhook (POST)  │       │ verify sig + idempot │ admin │  • marketing.contacts│
│                   │       └──────────────────────┘       │    (mirror)          │
│  GET /api/cron/   │                                       └──────────────────────┘
│   trial-reminders │       ┌──────────────────────┐
│  (Bearer secret)  │──────▶│  Resend              │
└───────────────────┘       │  • trial-day-10      │
                            │  • trial-day-13      │
                            │  • payment-failed    │
                            └──────────────────────┘
```

Key invariants:
- **Stripe is the source of truth for billing state.** Our DB is a *mirror*, populated only by webhooks.
- **All money flows through Stripe Checkout / Portal.** We never see card numbers (PCI SAQ-A scope).
- **Idempotency is enforced** by `event.id` keying into `public.stripe_webhook_events`.
- **Two-brand isolation** is enforced server-side: `organizations.industry_type` selects the price IDs and portal configuration. Cross-brand price use is rejected with HTTP 400.

---

## 2. Repo entrypoints

| Path | What it does |
| --- | --- |
| `scripts/stripe/setup.ts` | Idempotent provisioning script. Creates products / prices / portal configs / webhook in either TEST or LIVE depending on which `sk_…` key you pass. Safe to re-run. |
| `scripts/stripe/verify.ts` | Read-only smoke test. Confirms every env var resolves to a real Stripe object and the webhook endpoint is enabled. |
| `scripts/stripe/e2e-browser.ts` | Playwright-driven end-to-end suite (T15–T18 in the test plan). Covers real Checkout, Portal switch, card decline, trial gate. |
| `scripts/stripe/README.md` | Quick reference for the provisioning script. |
| `scripts/stripe/test-results-2026-04-25.md` | Last full E2E test run (TEST mode, 18/18 passing). |
| `lib/stripe/client.ts` | Single Stripe SDK constructor. **Do not** instantiate `new Stripe()` anywhere else. |
| `lib/stripe/helpers.ts` | `getPortalConfigId(industry)`, `requireOrgOwnerOrAdmin`, `resolveOrganizationId`, `recordWebhookEvent` (idempotency). |
| `lib/billing/tiers.ts` | Tier metadata (display names, monthly/annual prices, brand naming, feature lists). Single source of truth for the tier system. |
| `lib/billing/trial.ts` | `isTrialActive`, `getTrialDaysRemaining`. Used by the dashboard layout to gate access. |
| `lib/billing/limits.ts` | Per-tier feature gates (locations, refresh frequency, channels). |
| `lib/email/templates/trial-day-10.tsx`, `trial-day-13.tsx`, `payment-failed.tsx` | React Email templates rendered on the cron run / webhook. |
| `app/api/stripe/checkout/route.ts` | Resolves price ID from `(industry, tier, cadence)`, ensures or creates a Stripe customer, creates a Checkout session. RBAC: owners/admins only. |
| `app/api/stripe/portal/route.ts` | Mints a Customer Portal session bound to the brand's portal config. |
| `app/api/stripe/webhook/route.ts` | Verifies signature, idempotency-checks, dispatches handlers per event. |
| `app/api/cron/trial-reminders/route.ts` | Daily cron: queries trialing orgs, sends Day-10 / Day-13 emails, dedupes via `trial_reminder_sends`. |
| `app/(dashboard)/settings/billing/page.tsx` | Billing UI: current plan, upgrade buttons, Manage billing. |
| `app/(dashboard)/settings/billing/upgrade-buttons.tsx` | The 3-tier card grid + monthly/annual toggle. POSTs to `/api/stripe/checkout`. |
| `app/(dashboard)/settings/billing/manage-billing-button.tsx` | "Manage billing" button. POSTs to `/api/stripe/portal` and opens the returned URL. |
| `components/billing/trial-banner.tsx` | Top-of-dashboard countdown banner shown during trial. |
| `components/billing/trial-expired-gate.tsx` | Full-page gate that replaces the dashboard once a trial ends without conversion. |
| `components/billing/dunning-banner.tsx` | Top-of-dashboard banner shown when `payment_state='past_due'`. |
| `supabase/migrations/20260424182306_stripe_production.sql` | Adds `payment_state`, `stripe_price_id`, `current_period_end`, `cancel_at_period_end`, `trial_ends_at` to `organizations`; creates `stripe_webhook_events` + `trial_reminder_sends`. |
| `vercel.json` | Cron schedule for `/api/cron/trial-reminders` (09:00 UTC daily). |

---

## 3. Pre-launch checklist

If every box below is ticked, you can accept real payments.

### Stripe
- [ ] Live account activated (Stripe → Settings → Account → Verify business identity).
- [ ] Bank account connected for payouts (Stripe → Settings → Payouts).
- [ ] `setup.ts` run against LIVE — produced 6 products, 12 prices, 2 portal configs, 1 webhook endpoint.
- [ ] Stripe Tax configured (or explicitly disabled) — `setup.ts` does **not** manage tax.
- [ ] Statement descriptor set (Stripe → Settings → Public details). Customers will see this on credit-card statements.
- [ ] Receipts enabled (Stripe → Settings → Emails). Stripe sends receipts; we don't.

### Repo / .env.local (local dev)
- [ ] `STRIPE_SECRET_KEY=sk_live_…` (or `sk_test_…` for staging).
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_…` (the one printed by `setup.ts` on first run, OR pulled from Dashboard → Webhooks → endpoint → Signing secret).
- [ ] All 12 `STRIPE_PRICE_ID_*` values set.
- [ ] Both `STRIPE_PORTAL_CONFIG_*` values set.
- [ ] `NEXT_PUBLIC_APP_URL` matches the public origin Stripe will redirect to (e.g. `https://www.thevatic.com`).
- [ ] `RESEND_API_KEY` set (for trial reminders + dunning emails).
- [ ] `CRON_SECRET` set (gates the trial-reminder cron).
- [ ] `CLIENT_EMAILS_ENABLED=true` in production.
- [ ] `npx tsx scripts/stripe/verify.ts` reports **15 / 15 pass**.

### Vercel
- [ ] Same env block as `.env.local` configured under **Settings → Environment Variables** for the **Production** environment.
- [ ] Preview environment uses TEST keys (`sk_test_…`) so PRs don't hit live Stripe.
- [ ] `vercel.json` cron schedule deployed (verify in **Settings → Cron Jobs**).
- [ ] Domain `thevatic.com` (or `www.thevatic.com`) resolved and HTTPS active — Stripe webhooks **must** be HTTPS.

### Supabase
- [ ] Migration `20260424182306_stripe_production.sql` applied to the **production** project.
- [ ] `service_role` key in Vercel env (used by webhook handler).
- [ ] RLS policies allow `service_role` full access to `organizations`, `stripe_webhook_events`, `trial_reminder_sends`.

### Webhook
- [ ] Endpoint URL is `https://www.thevatic.com/api/stripe/webhook` (or whatever your prod origin is).
- [ ] Endpoint shows status **enabled** in Stripe Dashboard.
- [ ] All 10 events subscribed (see §9).
- [ ] Signing secret matches `STRIPE_WEBHOOK_SECRET` in Vercel.

### Auth + RBAC
- [ ] `requireOrgOwnerOrAdmin` is gating every Stripe-mutating route (verified — see `app/api/stripe/checkout/route.ts`, `app/api/stripe/portal/route.ts`).
- [ ] User clicking Subscribe is the org owner or admin.

### Smoke tests (in production, with real money)
- [ ] Subscribe with a real card on the smallest tier you offer ($149 Entry monthly), verify org row updates within ~5 s.
- [ ] Click Manage billing → confirm the Portal opens to the correct brand (Ticket or Neat).
- [ ] **Refund the smoke-test charge** in Stripe Dashboard → Payments → the charge → Refund.
- [ ] Cancel the smoke-test subscription in Stripe Dashboard, confirm org row goes back to `free/canceled`.

### Internal
- [ ] BLUEPRINT.md updated for the rollout milestone.
- [ ] Runbook (this doc) reviewed by at least one other engineer.
- [ ] PostHog event `stripe_checkout_completed` firing (instrumentation client).

---

## 4. Environment variables

All variables live in `.env.local` (development) and Vercel → Settings → Environment Variables (preview + production).

`.env.example` in the repo root documents these, but we expand each one here so you understand *why* it exists, *where* to get it, and *what breaks* if it's wrong.

### Stripe — money

| Variable | Example value | Source | What it does | Failure mode |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | `sk_live_51TK0AR…` | Stripe Dashboard → Developers → API keys | Server-side SDK key. **Never** exposed to browser. | Wrong mode (test vs live mismatch with price IDs) → all calls 404. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_2PcH4K1f…` | Stripe Dashboard → Developers → Webhooks → endpoint → Signing secret. Also printed by `setup.ts` on first run. | Verifies inbound webhook signatures (HMAC-SHA256). Without this, `/api/stripe/webhook` returns 400 to all events. | Stripe events keep retrying for 3 days → exponential backoff visible in Dashboard. |
| `STRIPE_PRICE_ID_TICKET_ENTRY_MONTHLY` | `price_1TPrTC…` | `setup.ts` output. | Resolves `(restaurant, entry, monthly) → price_id` in checkout. | Checkout returns "Unknown price for industry/tier/cadence". |
| `STRIPE_PRICE_ID_TICKET_ENTRY_ANNUAL` | `price_1TPrTF…` | `setup.ts` output. | (annual variant) | (same) |
| `STRIPE_PRICE_ID_TICKET_MID_MONTHLY` | `price_1TPrTJ…` | `setup.ts` | Mid tier ($299/mo) — **only tier with a 14-day trial**. | Checkout fails for Ticket Mid. |
| `STRIPE_PRICE_ID_TICKET_MID_ANNUAL` | `price_1TPrTN…` | `setup.ts` | | |
| `STRIPE_PRICE_ID_TICKET_TOP_MONTHLY` | `price_1TPrTR…` | `setup.ts` | Top ($499/mo) | |
| `STRIPE_PRICE_ID_TICKET_TOP_ANNUAL` | `price_1TPrTV…` | `setup.ts` | | |
| `STRIPE_PRICE_ID_NEAT_ENTRY_MONTHLY` | `price_1TPrTZ…` | `setup.ts` | Neat (liquor_store) Entry. | |
| `STRIPE_PRICE_ID_NEAT_ENTRY_ANNUAL` | `price_1TPrTf…` | | | |
| `STRIPE_PRICE_ID_NEAT_MID_MONTHLY` | `price_1TPrTk…` | | | |
| `STRIPE_PRICE_ID_NEAT_MID_ANNUAL` | `price_1TPrTo…` | | | |
| `STRIPE_PRICE_ID_NEAT_TOP_MONTHLY` | `price_1TPrTs…` | | | |
| `STRIPE_PRICE_ID_NEAT_TOP_ANNUAL` | `price_1TPrTx…` | | | |
| `STRIPE_PORTAL_CONFIG_TICKET` | `bpc_1TPria…` | `setup.ts` | Ensures Ticket customers in the Portal only see Ticket products and never Neat. | Without this, Portal opens to the *default* config which mixes brands. |
| `STRIPE_PORTAL_CONFIG_NEAT` | `bpc_1TPria…` | `setup.ts` | (same, Neat side) | |
| `STRIPE_SECRET_TEST_KEY` | `sk_test_51TK0AR…` | Stripe Dashboard → API keys (Test mode toggle on). | Optional — used by E2E browser test script. **Not** referenced by application code. | E2E tests can't run; production unaffected. |

> **Naming convention:** `STRIPE_PRICE_ID_<BRAND>_<TIER>_<CADENCE>`, all uppercase. `app/api/stripe/checkout/route.ts` builds this name dynamically — adding a new tier requires updating both `lib/billing/tiers.ts` and `setup.ts`.

### Supabase

| Variable | Example | Source | Role |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://triodvds…supabase.co` | Supabase → Project Settings → API → Project URL | Used by browser + server clients. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOi…` | Supabase → API → Project API keys → `anon` | RLS-enforced public-readable key (browser). |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi…` | Supabase → API → Project API keys → `service_role` | Server-only. Bypasses RLS. Used by webhook handler, cron jobs, admin clients. **Never** ship to browser. |

### App / Auth

| Variable | Example | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://www.thevatic.com` | Used as `success_url`/`cancel_url` for Checkout and `return_url` for Portal. **Must match a real public origin** — Stripe will refuse `localhost` for live mode. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth IDs from Google Cloud Console. | Sign-in. Authorized redirect URI must be `https://<SUPABASE_URL>/auth/v1/callback`. |

### Resend (transactional email)

| Variable | Example | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | `re_…` | Resend → API Keys. Used by Day-10/Day-13 trial reminders and `payment-failed` dunning. |
| `CLIENT_EMAILS_ENABLED` | `true` | Master switch on `lib/email/send.ts`. Production: `true`. Local dev: `false` to avoid spamming yourself. |

### Cron

| Variable | Example | Notes |
| --- | --- | --- |
| `CRON_SECRET` | a 32-char random string | Vercel Cron passes `Authorization: Bearer <CRON_SECRET>`. Without it, anyone can trigger your trial-reminder job by hitting the URL. |

### PostHog (optional but recommended)

| Variable | Example |
| --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_…` |
| `NEXT_PUBLIC_POSTHOG_HOST` | `/ingest` (proxied via `next.config.ts`) |

---

## 5. Stripe Dashboard configuration

Most of this is automated by `scripts/stripe/setup.ts`, but a few items must be done manually in the Dashboard.

### 5.1 Account activation (manual, one-time)

1. Sign in to [dashboard.stripe.com](https://dashboard.stripe.com).
2. **Settings → Account details:** business name (`Alive Labs LLC`), business URL (`https://www.thevatic.com`), support email, support phone.
3. **Settings → Verification:** complete all KYC documents. Stripe holds payouts until this is finished.
4. **Settings → Payouts:** connect business bank account.
5. **Settings → Public details:** statement descriptor — keep it short and recognizable, e.g. `THEVATIC` or `TICKET`. Customers see this on their card statement; an unfamiliar descriptor is the #1 driver of chargebacks.
6. Toggle **off** the "Test mode" switch in the top-left to confirm you're configuring LIVE.

### 5.2 Provisioning script (automated)

```bash
# From repo root, with .env.local containing sk_live_… and APP_URL=https://www.thevatic.com:
npx tsx scripts/stripe/setup.ts
```

The script is idempotent — every product/price/portal config/webhook carries `metadata.vatic_key`. Re-run it any time you change product descriptions or webhook event lists.

It will print an env block — **paste it into Vercel** (Settings → Environment Variables → Production), not just `.env.local`.

The webhook signing secret (`whsec_…`) is only printed **the first time** the endpoint is created. If you lose it, either (a) reveal it in the Dashboard (Webhooks → endpoint → Signing secret → Reveal), or (b) delete the endpoint and re-run `setup.ts`.

### 5.3 Stripe Tax (manual decision)

Decide explicitly:
- **Skip:** OK for early launches if all customers are US small businesses and you're below the nexus threshold.
- **Enable:** Stripe → Settings → Tax → Activate. Then re-run `setup.ts` (the script doesn't manage tax_behavior, but Stripe respects the account-level setting at Checkout time).

When in doubt: **enable Stripe Tax** and let it auto-calculate. The cost is 0.5% of the transaction.

### 5.4 Customer Portal — what `setup.ts` configures

For each brand:
- Headline: `Ticket — Manage your subscription` / `Neat — Manage your subscription`.
- Privacy & ToS URLs: `https://getvatic.com/{brand}/privacy` and `/{brand}/terms`. **Update these to the real URLs** under your domain after launch (edit `setup.ts` and re-run).
- Features enabled: customer update (email/name/phone/address/tax_id), invoice history, payment method update, subscription cancel (at_period_end with reason capture), subscription update (price changes only, with prorations).
- Allowed price changes are **scoped to the same brand only** — Ticket customers cannot pick Neat tiers and vice versa.

### 5.5 Receipts & customer emails

Stripe → Settings → Emails:
- **Successful payments:** ON (Stripe sends receipt — we don't duplicate this).
- **Failed payments:** ON (Stripe sends + we send our `payment-failed` email via Resend with branded copy).
- **Subscription renewal reminders:** ON.
- **Refunds:** ON.

### 5.6 Fraud & Radar (optional)

Stripe → Radar → Rules. Defaults are sensible. Tweak only if you start seeing fraud patterns.

---

## 6. Supabase configuration

Production project ID: `triodvdspdsuudooyura`.

### 6.1 Schema migration

The Stripe rollout introduces:

```sql
-- organizations: new columns
alter table public.organizations
  add column if not exists payment_state          text,
  add column if not exists stripe_price_id        text,
  add column if not exists current_period_end     timestamptz,
  add column if not exists cancel_at_period_end   boolean default false,
  add column if not exists trial_ends_at          timestamptz,
  add column if not exists trial_started_at       timestamptz;

-- payment_state allowed values
alter table public.organizations
  add constraint organizations_payment_state_check
  check (payment_state is null
    or payment_state in ('trialing','active','past_due','canceled',
                         'incomplete','incomplete_expired','unpaid','paused'));

-- Webhook idempotency log
create table public.stripe_webhook_events (
  event_id      text primary key,
  event_type    text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

-- Trial reminder dedupe log
create table public.trial_reminder_sends (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reminder_day    smallint not null, -- 10 or 13
  sent_at         timestamptz not null default now(),
  unique (organization_id, reminder_day)
);
```

Apply via:

```bash
# CLI route
supabase db push

# Or via SQL editor in Dashboard
# Open supabase/migrations/20260424182306_stripe_production.sql, paste, run.
```

Verify:

```sql
select count(*) from public.stripe_webhook_events;          -- should not error
select count(*) from public.trial_reminder_sends;           -- should not error
select column_name from information_schema.columns
  where table_schema='public' and table_name='organizations'
  and column_name in ('payment_state','stripe_price_id','current_period_end',
                      'cancel_at_period_end','trial_ends_at','trial_started_at');
-- Expect 6 rows.
```

### 6.2 RLS policies

The webhook handler uses `service_role`, which bypasses RLS by design. The Manage Billing button uses the user's session, but only reads `organizations.industry_type`/`stripe_customer_id` for the user's *own* org (RBAC enforced by `requireOrgOwnerOrAdmin`).

You shouldn't need to add new policies for Stripe. The migration already grants:

```sql
grant select, insert, update on public.stripe_webhook_events to service_role;
grant select, insert         on public.trial_reminder_sends   to service_role;
```

### 6.3 Auth redirect URLs

Supabase → Authentication → URL Configuration:
- **Site URL:** `https://www.thevatic.com`
- **Redirect URLs:** add `https://www.thevatic.com/auth/callback`, `https://www.thevatic.com/**`, `http://localhost:3000/**`.

(Without these, magic-link sign-in redirects to a 404.)

### 6.4 Service role usage audit

The service-role key is used in:
- `app/api/stripe/webhook/route.ts` — to update `organizations` from a webhook context (no user session).
- `app/api/cron/trial-reminders/route.ts` — to query trialing orgs.
- `lib/supabase/admin.ts` — the canonical service-role client constructor.

**Never call `createAdminSupabaseClient()` from any code that runs in the browser.** All current usages are server-side.

---

## 7. Vercel configuration

### 7.1 Environments

Vercel has three environments per project: **Production**, **Preview**, **Development**.

| Environment | Stripe key | Notes |
| --- | --- | --- |
| Production | `sk_live_…` | Real money. Webhook endpoint points at `www.thevatic.com`. |
| Preview | `sk_test_…` | PR previews shouldn't hit live Stripe. Use TEST price IDs and a separate TEST webhook. |
| Development | not used (local `.env.local` instead) | |

### 7.2 Add the env block

In Vercel → Project → **Settings → Environment Variables**, paste every value from §4. For each one, select the environment(s) it should apply to:
- Stripe LIVE keys → Production only.
- Stripe TEST keys → Preview only (optional).
- `NEXT_PUBLIC_SUPABASE_URL` → all envs.
- `SUPABASE_SERVICE_ROLE_KEY` → all envs (production + preview should use *the same* Supabase project for now; if you spin up a separate staging Supabase, give Preview its own keys).
- `NEXT_PUBLIC_APP_URL` → set per env: `https://www.thevatic.com` (prod) and `https://<branch>.vercel.app` (preview, but in practice `Vercel preview URL` lookups are awkward — leave preview blank and Vercel will auto-set `VERCEL_URL`).

> **One-time gotcha:** changing env vars in Vercel only affects new deployments. If a value changes, redeploy.

### 7.3 Domain

Project → **Settings → Domains:**
1. Add `thevatic.com` and `www.thevatic.com` (set `www` as primary; redirect apex to www).
2. Vercel issues an SSL cert automatically.
3. In your DNS provider, point `www` (CNAME) and `@`/apex (A or ALIAS) to Vercel's targets shown in the panel.

Stripe webhooks **must** be HTTPS — `http://` URLs will be rejected.

### 7.4 Cron

`vercel.json` declares:

```json
{
  "crons": [
    { "path": "/api/cron/daily",            "schedule": "0 6 * * *" },
    { "path": "/api/cron/trial-reminders",  "schedule": "0 9 * * *" }
  ]
}
```

After deploy, verify in **Settings → Cron Jobs** that both rows show up. To manually trigger for testing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://www.thevatic.com/api/cron/trial-reminders
```

### 7.5 Function configuration

`/api/stripe/webhook` and `/api/cron/trial-reminders` declare `export const maxDuration = 60` — Vercel's hobby tier defaults to 10 s, which is too short for the cron's email batch. On Pro+, 60 s is fine.

---

## 8. Resend configuration

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add domain:** add `thevatic.com`. Resend prints DNS records (SPF, DKIM, MX, optional DMARC). Paste each into your DNS provider.
3. Wait until **Verified** (usually under 5 min).
4. **API Keys → Create:** scope = "Full access". Save as `RESEND_API_KEY` in Vercel env.
5. Verify the sender in `lib/email/send.ts` defaults to a `*@thevatic.com` address that lives under the verified domain.
6. Send a test email locally:
   ```bash
   npx tsx -e 'require("dotenv").config({path:".env.local"}); require("./lib/email/send").sendEmail({to:"you@example.com",subject:"test",react:require("react").createElement("p",{},"hello")}).then(console.log)'
   ```

If Resend bounces the domain, double-check the DKIM record — quoted dots in TXT records are a classic DNS pitfall.

---

## 9. Webhook configuration & event flow

### 9.1 Endpoint setup

Endpoint URL: `https://www.thevatic.com/api/stripe/webhook`.

10 events subscribed (configured by `setup.ts`):

| Event | Purpose |
| --- | --- |
| `checkout.session.completed` | First sub created — write `stripe_customer_id` + `stripe_subscription_id` + `subscription_tier` to org row. |
| `customer.subscription.created` | Backup path for tier write (some checkouts don't fire `checkout.session.completed`, e.g. created via API). |
| `customer.subscription.updated` | Tier changes (Entry → Mid), cadence flips (monthly → annual), `cancel_at_period_end` toggles, trial end. |
| `customer.subscription.deleted` | Hard cancel — set org back to `subscription_tier='free', payment_state='canceled'`. |
| `customer.subscription.trial_will_end` | Stripe-native 3-day-out trial reminder. (We also send Day-10 / Day-13 via cron.) |
| `customer.updated` | Email/name changes from the Customer Portal. Mirror to `marketing.contacts`. |
| `customer.deleted` | Hard customer delete (rare; only via API) — clear `stripe_customer_id`. |
| `invoice.payment_failed` | Set `payment_state='past_due'`, send `payment-failed` email via Resend. |
| `invoice.paid` | After dunning recovers, clear `payment_state` back to `active`. |
| `invoice.payment_succeeded` | Same as `invoice.paid` (Stripe fires both for some payment types). |

### 9.2 Verification flow

`app/api/stripe/webhook/route.ts`:

```text
1. Read raw body + Stripe-Signature header
2. stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)  ← throws on tamper
3. recordWebhookEvent(event.id, event.type)
   - If event.id already in stripe_webhook_events with processed_at set: return 200 (duplicate, no-op).
   - Else: insert row.
4. switch (event.type) { … }                                          ← per-handler logic
5. Mark stripe_webhook_events.processed_at = now()
6. Return 200
```

Common errors:
- **400 "No signatures matching expected"** — `STRIPE_WEBHOOK_SECRET` mismatch. Re-copy from Dashboard.
- **500** — handler threw. Check Vercel logs (or Stripe Dashboard → Webhooks → endpoint → Logs).
- Stripe retries 3 days with exponential backoff. After 3 days the event is permanently failed and the endpoint may be auto-disabled (you'll get an email from Stripe).

### 9.3 Replay

To replay an event (e.g. after fixing a handler bug):

```bash
# Find the event:
stripe events list --limit 10

# Resend it to your endpoint:
stripe events resend evt_…
```

Idempotency means we won't double-write — but if the previous attempt errored before `processed_at` was set, the resend will re-run the handler.

---

## 10. Cron jobs

### 10.1 Trial reminders (`/api/cron/trial-reminders`)

Runs daily at **09:00 UTC**.

Logic (in `app/api/cron/trial-reminders/route.ts`):

```text
1. Bearer token check → reject if not Vercel Cron or not matching CRON_SECRET.
2. Query: organizations where payment_state='trialing' and trial_ends_at is not null.
3. For each org:
   a. days_remaining = ceil((trial_ends_at - now) / 24h)
   b. If days_remaining ∈ {4, 1}, that maps to reminder_day {10, 13} (since trial is 14 days).
   c. Look up trial_reminder_sends for (org_id, reminder_day) — skip if exists (dedupe).
   d. Render trial-day-10 or trial-day-13 React Email template.
   e. sendEmail() via Resend.
   f. Insert row into trial_reminder_sends.
4. Return JSON { sent, skipped }.
```

Dedupe is *strict* — even across multiple cron runs in the same day, an org won't get two Day-10 emails.

### 10.2 Manual trigger / debug

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://www.thevatic.com/api/cron/trial-reminders | jq .

# Expected:
# { "sent": 2, "skipped": 5, "errors": [] }
```

To force a reminder for QA, set `trial_ends_at` to a date 4 or 1 days out:

```sql
update public.organizations
  set trial_ends_at = now() + interval '4 days'
  where id='<test_org_id>';
delete from public.trial_reminder_sends where organization_id='<test_org_id>';
```

Then hit the cron URL.

---

## 11. End-to-end testing in TEST mode

The full process is documented in `scripts/stripe/test-results-2026-04-25.md`. Quick recap:

1. Back up `.env.local`:
   ```bash
   cp .env.local .env.local.live.backup
   ```
2. Replace Stripe keys with TEST equivalents (run `setup.ts` with `sk_test_…`):
   ```bash
   STRIPE_SECRET_KEY=sk_test_… APP_URL=http://localhost:3000 npx tsx scripts/stripe/setup.ts
   # Paste output into .env.local
   ```
3. Verify:
   ```bash
   npx tsx scripts/stripe/verify.ts   # expect 15/15 pass
   ```
4. Start servers:
   ```bash
   # Terminal 1
   npm run dev
   # Terminal 2 — captures the dynamic webhook secret for local
   stripe listen --forward-to http://localhost:3000/api/stripe/webhook \
     --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed,customer.updated,customer.deleted,invoice.finalized,invoice.upcoming,invoice.paid,invoice.created
   # Copy whsec_… into .env.local STRIPE_WEBHOOK_SECRET, restart `npm run dev`.
   ```
5. Run the browser suite:
   ```bash
   PLAYWRIGHT_BROWSERS_PATH=$(pwd)/.playwright-browsers \
     npx tsx scripts/stripe/e2e-browser.ts
   ```
6. Restore live keys:
   ```bash
   mv .env.local.live.backup .env.local
   npx tsx scripts/stripe/verify.ts   # expect 15/15 pass on LIVE
   ```

Test cards (Stripe TEST mode only):
- `4242 4242 4242 4242` — success.
- `4000 0000 0000 9995` — declined (insufficient funds).
- `4000 0027 6000 3184` — requires 3DS authentication.
- `4000 0000 0000 0341` — succeeds, then triggers `invoice.payment_failed` on next renewal.

---

## 12. Going live (cutover runbook)

Order of operations matters. Do this once.

1. **Day before:** announce maintenance window in your status channel.
2. **Confirm Stripe LIVE prerequisites** (§5.1). Activation can take Stripe up to 24 h to approve.
3. **Run `setup.ts` against LIVE:**
   ```bash
   STRIPE_SECRET_KEY=sk_live_… APP_URL=https://www.thevatic.com npx tsx scripts/stripe/setup.ts
   ```
4. **Capture the printed env block.** This is your only chance to grab `STRIPE_WEBHOOK_SECRET` automatically.
5. **Update Vercel Production env** with all values. Save.
6. **Apply Supabase migration** (§6.1). Verify queries.
7. **Trigger a Vercel redeploy** (Deploys → … → Redeploy). The new env vars take effect.
8. **Run `verify.ts` against the live env** (locally with the live keys). Expect 15/15 pass.
9. **Smoke test in production with a real card on yourself:**
   - Subscribe to Ticket Entry monthly ($149).
   - Open Stripe Dashboard → Customers — confirm the customer was created.
   - Open Supabase → `organizations` — confirm your row has `subscription_tier='entry', payment_state='active'`, correct `stripe_subscription_id`.
   - Click Manage billing → Portal opens to Ticket products only.
   - **Refund the charge** in Stripe Dashboard, then **cancel the subscription**. Confirm the org row goes back to `free/canceled`.
10. **Open the gate:** remove any "coming soon" or invite-only flags from your landing page.
11. **Watch Stripe Dashboard → Events for the first hour** to catch any anomaly.

---

## 13. Operational runbook

### 13.1 "A customer says they paid but their account is still on free"

```sql
-- 1. Find their org
select id, name, subscription_tier, payment_state, stripe_customer_id, stripe_subscription_id
  from public.organizations where name ilike '%<customer name>%';

-- 2. Cross-reference Stripe Dashboard → Customers → search by email or stripe_customer_id.
-- Look at the subscription state there.

-- 3. Check our webhook log
select event_type, received_at, processed_at, error
  from public.stripe_webhook_events
  order by received_at desc limit 20;
```

If Stripe shows `active` but our DB shows `free`, the webhook didn't process. Replay it:

```bash
stripe events resend evt_…
```

If the webhook isn't firing at all, check Stripe Dashboard → Webhooks → endpoint → Logs for delivery failures.

### 13.2 "I need to manually upgrade an org"

Don't. Always make Stripe do it (so the receipts and proration are correct). If it's truly an emergency (e.g. our webhook is broken):

```sql
update public.organizations set
  subscription_tier='top', payment_state='active'
  where id='<org_id>';
```

…and remember to fix it back from Stripe later.

### 13.3 "Cron didn't send a reminder"

```sql
-- Check what would have been sent
select id, name, trial_ends_at,
  ceil(extract(epoch from (trial_ends_at - now())) / 86400) as days_left
  from public.organizations
  where payment_state='trialing';

-- Check what was sent
select * from public.trial_reminder_sends order by sent_at desc limit 20;
```

Manually trigger:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://www.thevatic.com/api/cron/trial-reminders
```

### 13.4 "Refund a charge"

Stripe Dashboard → Payments → click the charge → Refund. Stripe handles the customer email and our webhook (`charge.refunded`, currently *not* subscribed) doesn't fire — that's intentional; refunds don't change subscription state by themselves.

If you need to also cancel: go to Stripe Customer → Subscriptions → cancel.

### 13.5 "Rotate the webhook signing secret"

1. Stripe Dashboard → Webhooks → endpoint → "Roll secret".
2. Stripe gives you 24 h where both old and new secrets are valid.
3. Update `STRIPE_WEBHOOK_SECRET` in Vercel.
4. Redeploy.
5. After 24 h, the old secret is dead.

### 13.6 "I changed a tier price"

Stripe prices are immutable. To "change a price" you actually create a new one and archive the old.

`setup.ts` handles this:
1. Update `PRICE_USD_CENTS` in `scripts/stripe/setup.ts`.
2. Run `npx tsx scripts/stripe/setup.ts`.
3. The script creates a new price, updates env vars, and the next checkout will use the new ID.
4. **Existing subscriptions stay on the old price** until they renew or the customer changes tier — this is by design (no surprise hikes).

### 13.7 "Disable a brand temporarily"

There's no first-class flag. Easiest: archive its products in the Stripe Dashboard. Checkout will fail with a clear error. (Or set the corresponding `STRIPE_PRICE_ID_*` env to empty — `app/api/stripe/checkout/route.ts` will return 500.)

---

## 14. Adding a new brand or tier

Steps in order:

1. **Pricing brief** — write it down. This is non-negotiable; pricing changes are forever in your customer's mental model.
2. `lib/billing/tiers.ts` — add tier metadata, display names per brand.
3. `lib/billing/limits.ts` — add per-tier feature gates.
4. `lib/verticals.ts` — add new `industry_type` if it's a new brand.
5. `scripts/stripe/setup.ts` — add to `PRODUCT_SPECS` and `PRICE_USD_CENTS`.
6. `scripts/stripe/verify.ts` — add expected env-var names.
7. `.env.example` — document new env vars.
8. Run `setup.ts` in TEST mode, run `verify.ts`, run `e2e-browser.ts` (you may need to add new test cases).
9. Run `setup.ts` in LIVE mode, update Vercel env, redeploy.
10. Update §4 of this doc.

---

## 15. Security model & PCI scope

We are PCI **SAQ-A**: the lightest scope, applicable to merchants who outsource all card handling to a PCI-certified provider (Stripe).

What we *do* touch:
- Stripe customer IDs (`cus_…`) — non-sensitive.
- Subscription IDs (`sub_…`) — non-sensitive.
- Price IDs (`price_…`) — non-sensitive.
- Email addresses, names, billing addresses — PII subject to GDPR/CCPA, **not** PCI.

What we *never* touch:
- Card numbers, CVC, expiry. Stripe Checkout / Portal handle these in iframes hosted on `*.stripe.com`.
- Bank account numbers. Stripe Connect handles these (we don't use Connect).

To stay SAQ-A:
- **Never** add a card field to our own forms. If a feature seems to require it, route through Stripe Elements/Checkout instead.
- **Never** log raw card data (we don't, but a good rule).
- **Never** post to `api.stripe.com` from the browser with secret keys (we don't — only `STRIPE_SECRET_KEY` is server-side).

Webhook signing secret (`whsec_…`) is treated like a bearer token: Vercel env only, never logged.

Service-role key is the most powerful credential we have. It bypasses RLS. Treat it like the master key: Vercel env only, audit usages quarterly.

---

## 16. Monitoring, alerting, and dashboards

### 16.1 Stripe-native

- **Stripe Dashboard → Events** — every API call + webhook delivery, real-time. First place to look for "did Stripe receive it?" / "did we ack it?"
- **Stripe Dashboard → Webhooks → endpoint → Logs** — per-delivery status. Failed deliveries highlighted.
- **Stripe Dashboard → Sigma** (paid) — SQL over Stripe data.
- **Stripe Dashboard → Reports** — MRR, churn, gross revenue. Refresh daily.

### 16.2 Application-side

- **Vercel Logs** — search for `[stripe]` or `webhook` to scope.
- **Supabase SQL queries** — quick health snapshots:
  ```sql
  -- Active subscriptions by tier
  select subscription_tier, payment_state, count(*)
    from public.organizations
    where stripe_subscription_id is not null
    group by 1,2 order by 1,2;

  -- Webhook activity last 24 h
  select event_type, count(*) filter (where processed_at is not null) as ok,
    count(*) filter (where error is not null) as err
    from public.stripe_webhook_events
    where received_at > now() - interval '1 day'
    group by 1 order by 2 desc;

  -- Stuck dunning (past_due > 7 days)
  select id, name, payment_state, current_period_end
    from public.organizations
    where payment_state='past_due'
    and current_period_end < now() - interval '7 days';
  ```

### 16.3 Alerting

Recommended (set up after launch):
- Stripe → Settings → Notifications: enable "Failed payments" + "Disputed payments" emails.
- PostHog → Alerts on `stripe_checkout_failed` event spike.
- Vercel → Logs → "Functions errored last hour" Slack webhook (or use Sentry integration).

---

## 17. Glossary & reference

| Term | Definition |
| --- | --- |
| **Brand** | A user-facing product identity (Ticket = restaurants, Neat = liquor stores). 1:1 with `industry_type`. |
| **Tier** | A pricing level inside a brand (Entry / Mid / Top). |
| **Cadence** | Billing frequency (monthly / annual). Annual = 20% discount vs monthly × 12. |
| **payment_state** | Mirror of `stripe.subscription.status`: `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `incomplete_expired`, `unpaid`, `paused`. |
| **subscription_tier** | Our tier enum: `free`, `entry`, `mid`, `top`, `suspended`. `suspended` is a manual hold (admin action). |
| **Trial** | 14-day, **Mid tier only**, **card required**. Stripe-native (`trial_period_days`). |
| **Dunning** | The process of recovering a failed payment. Stripe handles the retry schedule (4 attempts over ~3 weeks). We render a banner + send a Resend email on `invoice.payment_failed`. |
| **Idempotency key** | We use `event.id` from the webhook payload as a primary key in `stripe_webhook_events`. Retries are no-ops. |
| **PCI SAQ-A** | The card-handling compliance scope we operate under (lowest tier). Earned by routing all card data through Stripe-hosted UIs. |

### Useful Stripe CLI commands

```bash
# Tail webhook deliveries to local
stripe listen --forward-to http://localhost:3000/api/stripe/webhook

# Trigger a fixture event
stripe trigger customer.subscription.created
stripe trigger invoice.payment_failed

# List recent events
stripe events list --limit 5

# Inspect a customer
stripe customers retrieve cus_…

# Inspect a subscription
stripe subscriptions retrieve sub_…

# Cancel a subscription right now
curl -u "$STRIPE_SECRET_KEY:" \
  -X DELETE https://api.stripe.com/v1/subscriptions/sub_…

# Refund a payment intent
stripe refunds create --payment-intent pi_…
```

### Useful internal scripts

```bash
# Provision (first run or update)
npx tsx scripts/stripe/setup.ts

# Read-only health check
npx tsx scripts/stripe/verify.ts

# Browser-driven E2E (TEST mode only)
PLAYWRIGHT_BROWSERS_PATH=$(pwd)/.playwright-browsers npx tsx scripts/stripe/e2e-browser.ts
```

---

**Owner of this document:** the engineer most recently merging Stripe-related PRs. Update it whenever you change Stripe, Vercel, Supabase, or Resend configuration. PRs that touch `lib/stripe/`, `app/api/stripe/`, `scripts/stripe/`, or `vercel.json` should also touch this file.
