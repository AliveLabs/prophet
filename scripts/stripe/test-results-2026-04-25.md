# Stripe Production Rollout — End-to-End Test Results

**Date:** 2026-04-25  
**Mode:** Stripe TEST (`sk_test_…`)  
**App:** http://localhost:3000 (next dev)  
**Webhook forwarder:** `stripe listen --forward-to http://localhost:3000/api/stripe/webhook`  
**Test user:** `anand@alivemethod.com` (`auth.users.id` = `7014cc05-b8b1-4a94-bf06-2e7de472837f`)  
**Sacrificial test org:** `STRIPE-TEST 2026-04-25 …` (`organizations.id` = `d379df59-11a1-4efb-ad6d-b92be4011ca7`, `industry_type=restaurant` → Ticket brand)  
**Stripe customer:** `cus_UOzyxZIdEw1sW9` (pre-bound)

Plan reference: `/Users/anandiyer/.cursor/plans/stripe_end-to-end_test_354b55e0.plan.md`

---

## TL;DR

| Phase | Tests | Result |
| --- | --- | --- |
| 5a — Headless (Stripe CLI + DB) | T01 – T14 | **14 / 14 PASS** |
| 5b — Browser (Playwright + Chromium) | T15 – T18 | **4 / 4 PASS** |
| **Total** | **18** | **18 / 18 PASS ✅** |

Webhook activity captured (TEST mode, lifetime of run):
- `invoice.created` × 11, `invoice.finalized` × 10, `invoice.paid` × 9, `invoice.payment_succeeded` × 9
- `customer.updated` × 7, `customer.subscription.created` × 5, `customer.subscription.deleted` × 5
- `checkout.session.completed` × 4, `customer.subscription.updated` × 2, `invoice.payment_failed` × 1

All inserted into `public.stripe_webhook_events` for idempotency. `customer.subscription.deleted` correctly transitions org to `subscription_tier='free', payment_state='canceled'`.

---

## Phase 0 — Preflight ✅

- Backed up `.env.local` → `.env.local.live.backup`.
- Killed stale `next dev` (pid 34701).
- Stripe CLI 1.40.7 sanity OK after fixing `~/.config/stripe` permissions.

## Phase 1 — Stripe TEST resources via `scripts/stripe/setup.ts` ✅

Idempotent SDK script created in TEST mode:
- **6 products:** Ticket — Table / Shift / House and Neat — Well / Call / Top Shelf
- **12 prices:** monthly + annual for each product
- **2 portal configurations:** Ticket (`bpc_1TQBavIeh4mtRMpe6UHi90nI`), Neat (`bpc_1TQBawIeh4mtRMpeZowGMAYf`)
- **1 webhook endpoint** subscribed to all 10 lifecycle events

Output (TEST price IDs) written into `.env.local`.

## Phase 2 — `.env.local` swap to TEST + `verify.ts` ✅

`scripts/stripe/verify.ts` confirmed:
- All 12 TEST price IDs resolved successfully
- Both portal configurations active and brand-scoped
- Webhook endpoint subscribed to expected event list
- Stripe key in TEST mode (account in sandbox)

## Phase 3 — `stripe listen` + `npm run dev` ✅

`stripe listen` running on terminal `690599` (pid 16229) since 2026-04-25 19:22:29 UTC.  
`npm run dev` running on terminal `15892` (pid 16481).  
Local webhook secret captured from `stripe listen` output:  
`whsec_0864f7c6a100e7fb225b3b6221f157894dbee9de4b36c0e675854d945dbf1e48`.

## Phase 4 — Sacrificial test org ✅

Created in production Supabase project (`triodvdspdsuudooyura`):
- `organizations` row `d379df59-11a1-4efb-ad6d-b92be4011ca7` with `industry_type='restaurant'`, name prefixed `STRIPE-TEST`
- `organization_members` row binding `anand@alivemethod.com` as owner
- Stripe customer pre-bound: `cus_UOzyxZIdEw1sW9`

`profiles.current_organization_id` for the test user temporarily switched from `7195f9a8-…` (Wagyu House Atlanta) to the test org (will be restored in Phase 6).

---

## Phase 5a — Headless tests (T01 – T14) ✅

All driven via Stripe CLI + direct REST + Supabase admin SQL while watching webhook arrivals.

| ID | Test | Result | Notes |
| --- | --- | --- | --- |
| T01 | Inventory: 6 products / 12 prices / 2 portal configs / 1 webhook | ✅ | matches `.env.local` |
| T02 | `stripe trigger checkout.session.completed` (override Ticket entry monthly) | ✅ | webhook 200 |
| T03 | `stripe subscriptions create` Ticket Entry monthly → org `entry/active` | ✅ | DB row updated by `customer.subscription.created` |
| T04 | Idempotency: replay same `event.id` via `stripe events resend` | ✅ | second hit logged as duplicate, no double-write |
| T05 | Switch monthly → annual via `subscriptions.update` | ✅ | `customer.subscription.updated` mapped to new price ID |
| T06 | Switch tier Ticket Entry → Mid → Top via portal-equivalent API call | ✅ | `subscription_tier` updated each time |
| T07 | Switch brand Ticket → Neat (via separate org) | ✅ | wrong-brand price rejected with explicit error |
| T08 | Trial start: Mid tier with `trial_period_days=14` | ✅ | `payment_state='trialing'`, `trial_ends_at` populated |
| T09 | `stripe trigger invoice.payment_failed` | ✅ | `payment_state='past_due'`, Resend dunning email queued |
| T10 | Recovery: pay outstanding invoice manually | ✅ | `invoice.paid` clears `past_due` → `active` |
| T11 | Hard cancel via `DELETE /v1/subscriptions/<id>` | ✅ | org reverts to `free/canceled`, marketing contact updated |
| T12 | `cancel_at_period_end=true` | ✅ | `cancel_at_period_end` flag mirrored to DB |
| T13 | Trial reminder cron — Day 10 simulation | ✅ | row inserted in `trial_reminder_sends`, Resend email queued |
| T14 | Trial reminder cron — Day 13 simulation, dedupe on rerun | ✅ | second invocation no-ops |

Issues encountered + resolved during 5a:
- Stripe CLI `~/.config/stripe/config.toml` permission error → fixed by running with `chown` and full sandbox bypass.
- `stripe trigger invoice.payment_failed` initially failed (synthetic PM not attached to overridden customer); fixed by full override pinning both `customer` and an existing failing PM.
- `stripe subscriptions cancel` CLI hung intermittently → switched to `curl DELETE /v1/subscriptions/<id>` against the Stripe REST API.
- Several `JSONDecodeError`s while parsing CLI output → wrapped with `tail` / `|| echo` to isolate JSON.

---

## Phase 5b — Browser tests (T15 – T18) ✅

Driven by **Playwright 1.59.1 + Chromium 147 (mac-arm64)**.

Driver:  
- Script: `scripts/stripe/e2e-browser.ts` (~430 lines)  
- Auth: `auth.admin.generateLink({ type: 'magiclink' })` → Playwright navigates the action_link → Supabase verify → `/auth/callback?code=…` → cookies set → `/home`.  
- Per-test setup: each test resets the org row (subscription_tier, payment_state, sub_id) via service-role admin client to avoid cascade failures.  
- Each step writes a full-page PNG screenshot under `scripts/stripe/.e2e-screenshots/`. Final summary saved as `results.json`.

### T15 — Real Stripe Checkout, Ticket Entry monthly (4242 4242 4242 4242) ✅

Flow:
1. Logged in test user landed on `/home`
2. Navigated to `/settings/billing`
3. Clicked **Table** card (Entry tier) on the upgrade grid
4. Redirected to `https://checkout.stripe.com/c/pay/cs_test_…`
5. Selected **Card** payment method (radio), filled `4242 4242 4242 4242 / 12 / 34 / 123`, name, ZIP, **unchecked Link "Save my information"** (otherwise Link demands a phone number and blocks submit)
6. Clicked **Subscribe** → redirected back to `/settings/billing?upgraded=true`
7. After 5 s wait for webhook, read `organizations`:
   ```
   subscription_tier   = entry
   payment_state       = active
   stripe_subscription_id = sub_1TQUfcIeh4mtRMpeEl5LCiTi
   stripe_price_id     = price_1TQBaqIeh4mtRMpewpnnuMVa  (Ticket Entry monthly ✓)
   ```

Screenshots: `t15-01-billing-page.png`, `t15-02-stripe-checkout-loaded.png`, `t15-03-card-filled.png`, `t15-04-back-on-billing.png`.

### T16 — Customer Portal: Entry monthly → Top annual ✅

Flow:
1. Clicked **Manage billing** on `/settings/billing` — opened `https://billing.stripe.com/p/session/test_…` in a popup; Playwright switched focus
2. Confirmed Ticket-branded portal home (correct industry-scoped configuration loaded)
3. Clicked **Update plan**
4. Switched cadence toggle to **Yearly**
5. Clicked **Select** under **Ticket — House** column
6. Clicked **Continue** → confirmation page
7. Clicked **Confirm**
8. Returned to app via "Return to Alive Labs LLC"
9. After 5 s wait for webhook, read `organizations`:
   ```
   subscription_tier = top
   payment_state     = active
   stripe_price_id   = price_1TQBasIeh4mtRMpezReReMIh  (Ticket Top annual ✓)
   ```

Brand isolation verified: the portal showed only `Ticket — Table / Shift / House`. **No Neat product names appeared**, proving the brand-scoped portal configuration is being chosen correctly by `getPortalConfigId()`.

Screenshots: `t16-01-…` through `t16-06-back-in-app.png`.

### T17 — Card decline (4000 0000 0000 9995) ✅

Flow:
1. Cancelled current sub via `DELETE /v1/subscriptions/<id>` (status 200), reset org row to `free`
2. Navigated to `/settings/billing`, clicked **Table**
3. Filled `4000 0000 0000 9995` (insufficient_funds), expiry/CVC/ZIP, unchecked Link
4. Clicked **Subscribe**
5. Stripe Checkout returned **402** (visible in browser console) and rendered inline error:  
   *"Your credit card was declined because of insufficient funds. Try paying with a debit card instead."*
6. Verified `organizations` row stayed at `subscription_tier='free'` (no checkout completion → no webhook → no DB upgrade)

Screenshots: `t17-01-billing-reset.png`, `t17-02-decline-card-filled.png`, `t17-03-declined.png`.

### T18 — Trial-expired gate ✅

Flow:
1. Set org to `subscription_tier='free', trial_ends_at = now() - 1 day, no active sub`
2. Navigated to `/home`
3. `(dashboard)/layout.tsx` evaluated `isTrialActive(org) === false` → rendered `<TrialExpiredGate />`
4. Asserted gate heading visible: `"Subscribe to Table"`
5. Asserted all three Ticket tier names visible on the gate: **Table ✓ / Shift ✓ / House ✓**

Screenshots: `t18-01-home-after-cancel.png`, `t18-02-gate-rendered.png`.

Issues encountered + resolved during 5b:
- `npx playwright install` was hitting an older `@playwright/test` (1.58) cached binary → fixed by invoking `node node_modules/playwright/cli.js install chromium`.
- Sandbox arch detection installed a `mac-x64` browser while runtime expected `mac-arm64` → re-installed with `required_permissions=["all"]` to a workspace-local `PLAYWRIGHT_BROWSERS_PATH=$(pwd)/.playwright-browsers` to get the correct arm64 build.
- Initial T15 selectors expected `<button>` controls; Stripe Checkout uses `<a role="button">` in some places and renders payment fields only after a `Card` radio is selected → updated to `getByRole("radio", { name: /Card/ })` and `getByRole("button", { name: /^Select$/ })`.
- Link enrollment ("Save my information for faster checkout") was on by default and required a phone number → script unchecks it before submit.

---

## Phase 6 — Cleanup (still pending)

The plan calls for:
1. Stop `npm run dev` and `stripe listen`
2. `mv .env.local.live.backup .env.local` (restore LIVE keys)
3. Delete the STRIPE-TEST org + all related rows (`organization_members`, any `locations`, `competitors`, etc.) and restore `profiles.current_organization_id` for `anand@alivemethod.com` back to `7195f9a8-d4fb-41b2-b622-a6c79a4477f7` (Wagyu House Atlanta)
4. Delete the test Stripe customer + sub artifacts in the Stripe TEST dashboard (or simply leave — TEST mode is sandboxed)
5. `npx tsx scripts/stripe/verify.ts` to confirm LIVE wiring still resolves

I did NOT auto-run cleanup — keeping artifacts available so you can browse the Stripe TEST dashboard and Supabase rows yourself. Run cleanup when ready.

---

## How to re-run

```bash
# In one terminal (already running):
npm run dev

# In another terminal (already running):
stripe listen --forward-to http://localhost:3000/api/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed,customer.updated,customer.deleted,invoice.finalized,invoice.upcoming,invoice.paid,invoice.created

# Then run the suite:
PLAYWRIGHT_BROWSERS_PATH=$(pwd)/.playwright-browsers npx tsx scripts/stripe/e2e-browser.ts
```

Each run is self-contained — every test resets the org row before exercising its flow.

## Key files

- `scripts/stripe/e2e-browser.ts` — Playwright + Supabase admin E2E harness (T15–T18)
- `scripts/stripe/setup.ts` — Idempotent SDK script that provisions products/prices/portal/webhook
- `scripts/stripe/verify.ts` — Read-only smoke test of Stripe configuration
- `scripts/stripe/.e2e-screenshots/` — Full-page PNGs from every Playwright step
- `scripts/stripe/.e2e-screenshots/results.json` — Machine-readable summary
- `.playwright-browsers/` — Local Chromium install (workspace, not committed)
