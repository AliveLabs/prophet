# Stripe production bootstrap

`scripts/stripe/setup.ts` is an idempotent Node.js script that creates all the
Stripe resources required for the two-brand (Ticket + Neat) subscription
platform in a single run. It can be re-run safely at any time; existing
resources are matched by `metadata.vatic_key` and updated in place, never
duplicated.

## What it creates

| Resource | Count | Notes |
|----------|------:|-------|
| Products | 6 | `ticket.{entry,mid,top}` and `neat.{entry,mid,top}` |
| Prices | 12 | Each product × `{monthly, annual}`. Annual = monthly × 12 × 0.80 (20% off). |
| Customer Portal configurations | 2 | One per brand. Each is restricted to its own prices for in-portal upgrades/downgrades. |
| Webhook endpoint | 1 | Points at `$APP_URL/api/stripe/webhook` with 10 event types enabled. |

Pricing matrix (USD / month, USD / year), from `Ticket_Neat_Pricing_Brief_Apr2026.txt`:

| Tier | Monthly | Annual | Trial |
|------|--------:|-------:|:------|
| Entry | $149 | $1,428 | – |
| Mid   | $299 | $2,868 | 14-day (card required) |
| Top   | $499 | $4,788 | – |

## Prerequisites

1. Stripe account. Test mode for staging, live mode for production.
2. `STRIPE_SECRET_KEY` from [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys).
   - Use `sk_test_...` for staging, `sk_live_...` for production.
3. `APP_URL` that points at your deployed app (must be publicly reachable for Stripe to deliver webhooks).

## Usage

```bash
# Staging
STRIPE_SECRET_KEY=sk_test_... \
APP_URL=https://staging.getvatic.com \
npx tsx scripts/stripe/setup.ts

# Production
STRIPE_SECRET_KEY=sk_live_... \
APP_URL=https://getvatic.com \
npx tsx scripts/stripe/setup.ts
```

The script prints a `.env` snippet at the end. Copy-paste it into:

- `.env.local` (dev)
- Vercel project → Settings → Environment Variables (staging + prod), scoped
  appropriately.

### Secrets that only appear once

**Webhook signing secret (`STRIPE_WEBHOOK_SECRET`)** is only returned when the
webhook endpoint is *first created*. On subsequent runs, the script prints the
existing endpoint ID but NOT its secret. If you lose the secret:

1. Stripe Dashboard → Developers → Webhooks → find the endpoint → "Reveal" the
   signing secret.
2. Or delete the endpoint in the Dashboard, then re-run the script to generate
   a fresh one (it will print the new secret).

## Idempotency model

Every created resource carries `metadata.vatic_key` — a stable deterministic
key derived from `(resource_type, brand, tier, cadence)`. On re-runs, the
script:

1. Lists existing resources (limited to 100 per type — we never have close to
   that many).
2. Looks up by `metadata.vatic_key`.
3. If found → calls the `update` endpoint with current spec. Prices are a
   special case: they are immutable in Stripe, so a change in amount/interval
   archives the old price (sets `active=false`) and creates a new one.
4. If not found → creates with the key.

This means you can change product descriptions, portal config options, or
webhook event lists and re-run the script to apply changes without touching
the Stripe Dashboard.

## What this script does NOT do

- Does not manage Tax rates (configure Stripe Tax in the Dashboard).
- Does not seed test customers or subscriptions.
- Does not wire environment variables into your deployment — you still need
  to paste the output into `.env` / Vercel.
- Does not delete old resources. If you renamed tiers (e.g. `starter` →
  `entry`), archive the legacy products/prices in the Dashboard manually.

## Post-setup verification

1. **Database migration**: ensure `supabase/migrations/20260424183000_stripe_production.sql`
   has been applied (creates `stripe_webhook_events`, `trial_reminder_sends`,
   and the new `organizations.payment_state` column).
2. **Live webhook test**: from the Stripe Dashboard, click "Send test webhook"
   on the new endpoint and verify `POST /api/stripe/webhook` returns 200.
   Verify a row appears in `public.stripe_webhook_events`.
3. **Checkout round-trip**: from a test user in staging, click a tier upgrade
   button, complete Stripe Checkout with test card `4242 4242 4242 4242`,
   verify `organizations.stripe_customer_id`, `stripe_subscription_id`, and
   `subscription_tier` are set correctly.
4. **Portal round-trip**: from `/settings/billing` click "Manage billing",
   verify the Portal shows the brand-appropriate products (Ticket customers
   should not see Neat tiers and vice versa).
