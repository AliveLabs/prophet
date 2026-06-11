# Trial & Tier Model Correction Plan — v2 (2026-06-11)

> v1 (free-tier kill, trial-of-Tier-1) is superseded. After Bryan + Chris aligned on
> 2026-06-11, the model matches what the Apr 2026 pricing brief (§ Trial Strategy)
> already specified — Anand's free-tier code contradicted the brief, not the other
> way around.

Bryan's directive, verbatim intent: **"There is no such thing as a free tier."**
There is a **free TRIAL, and the trial is OF TIER 2** (Shift / Call — the mid tier).

- **Trial = 14-day free trial of Tier 2 (mid)**, credit card collected during
  onboarding via Stripe Checkout (`trial_period_days: 14`,
  `payment_method_collection: 'always'`). Conversion = Stripe charges at trial end.
  Cancellation visible and frictionless (brief: builds trust with owner-operators).
- **Paid Tier 1 (entry) stays weekly** as configured today (briefingCadence
  `weekly_digest`). Trial gets the Tier-2 daily experience because the trial IS Tier 2.
- **Notification cadence** for the trial, both email and in-app:
  Day 10 (T-4) + Day 13 (T-1) emails (already built: `app/api/cron/trial-reminders`,
  Resend templates `trial-day-10/13`) **plus** an in-app trial banner that runs the
  length of the trial and escalates at T-4 / T-1 with honest charge-date + cancel copy.
- **Tier 1 own social = one network of the customer's choosing** (suggest Instagram
  first); competitor monitoring = ALL networks on every tier. T2/T3 own = all three.
  (Under trial-of-Tier-2, network-of-choice only bites after conversion to paid entry.)
- **Trial = single location.** Mid's maxLocations=1 covers it; make the trialing rule
  explicit anyway. Paid limits stay 1 / 1 / 3 (Bryan 2026-06-11: keep plan values).

## Access model (the one rule)

`isTrialActive(org)` — uniform, no `free` branch:

1. `subscription_tier = 'suspended'` → blocked (admin override).
2. `payment_state` present (org has been through Stripe) → blocked only on
   `canceled | incomplete_expired | unpaid`; `trialing/active/past_due/incomplete` OK.
3. `payment_state` null (never completed checkout) → active iff `trial_ends_at` in
   the future. Covers legacy internal-clock trials (pre-Stripe signups, e.g. Bush)
   and the 2099 internal orgs. **New orgs get NO clock at creation** → blocked until
   checkout completes. That null-clock state IS the CC gate.

`isTrialing(org)` helper = `payment_state === 'trialing'` OR
(`payment_state` null AND `trial_ends_at` future) — drives banners, cron daily-trial
rule, admin filters, add-location gate.

## Audit findings (2026-06-11, prod + code) — still true until Batch 1 lands

- `"free"` tier value across ~25 files, 17 `?? "free"` defaults. 4 sites have real
  free-tier BRANCHING (cron/daily 59/82-88, webhook marketing-mirror, billing page,
  visibility page cadence label) — case-by-case, not blind swap. Plus: layout.tsx:134
  banner condition, admin-email.ts trial filters, admin org pages/tables, sidebar
  badge, org-detail-client, e2e script.
- DB CHECK `organizations_subscription_tier_check_v2` allows
  `('free','entry','mid','top','suspended')` (20260525180019). Leave 'free' allowed;
  tighten later with types regen.
- Prod: 9 orgs `subscription_tier='free'` (Bush active-clock + expired tests),
  6 internal `top` (trial_ends 2099) — **leave the 6 as-is** (Bryan 2026-06-11).
- Stripe infra already correct: checkout trials mid only, card always,
  `missing_payment_method: 'cancel'`; webhook syncs tier/payment_state/trial_ends_at;
  day-10/13 reminder cron live (9:00 UTC) gated on `payment_state='trialing'` —
  clock-only trials (no CC) correctly get no "you'll be charged" email.
- Gap: onboarding never reaches Stripe — org creation hands out the internal clock,
  so every signup is a card-less "free" org.

### Batch 0 — loadSocial masking bug ✅ DONE (35c73f7, live-verified)
pickSocialSnapshot: usable beats unusable, newest content wins, IG only tiebreak.

### Batch 1 — kill the free tier + new trial semantics ✅ DONE (bd82e63)
- ☐ `SubscriptionTier` = `entry | mid | top | suspended`. Delete `free` from
  TIER_LIMITS / DISPLAY_NAMES; TIER_PRICING excludes only `suspended`.
  `asSubscriptionTier` fallback → `entry` (pre-migration 'free' rows degrade safely:
  payment_state null + clock still gates access; cron daily-trial rule keeps them daily).
- ☐ `trial.ts`: the access model above + `isTrialing` + `isPaidActive` helpers; tests.
- ☐ Rework branch sites: cron/daily (trial rule via isTrialing; post-trial weekly
  branch dies — cadence purely from TIER_LIMITS + trial rule), webhook
  (subscription.deleted / customer.deleted → 'entry'+canceled; marketing mirror paid
  check), billing page, visibility cadence label, layout banner condition,
  admin-email trial filters, admin paid filters (payment_state-aware), sidebar badge,
  org-detail isTrial, e2e script.
- ☐ 17 `?? "free"` → `?? "entry"` (the 13 safe ones verbatim; risky 4 via rework above).
- ☐ UI copy: "Free" label gone; trialing orgs show their tier + "(trial)".

### Batch 2 — CC collection at onboarding ✅ DONE (e331081)
- ☐ Org creation (`createOrgAndLocationAction`): STOP setting trial_started_at /
  trial_ends_at; insert `subscription_tier: 'mid'` explicitly (trial-pending). First
  data pull stays at location creation (one first_run = acquisition cost; recurring
  pulls already gate on isTrialActive, so no ongoing spend pre-card).
- ☐ Checkout API: optional `context: 'onboarding'` → success_url
  `/onboarding/checkout-complete?session_id={CHECKOUT_SESSION_ID}`, cancel back to
  the wizard's trial step.
- ☐ `/onboarding/checkout-complete`: server-side session verification → idempotent
  org sync (same fields as webhook; webhook remains source of truth) → `/home`.
  Kills the blocked-flash if the webhook lags the redirect.
- ☐ Onboarding wizard: final "Start your free 14-day trial" step — Tier-2 trial copy
  (what they get, card required, $0 today, charge date, cancel anytime, reminder
  promise), button → checkout(mid, monthly, context onboarding).
- ☐ TrialExpiredGate copy branches: never-started (trial_started_at null → "Start
  your free trial") vs expired ("Your trial ended").

### Batch 3 — in-app trial notification cadence ✅ DONE (be45295; reminder emails now bypass CLIENT_EMAILS_ENABLED — billing-critical)
- ☐ TrialBanner: show for the WHOLE trial (info tone), escalate at ≤4 days and
  ≤1 day; trialing-with-card copy shows charge date + amount + manage/cancel link;
  clock-only trials (no card) show "X days left — add a card to keep going".
- ☐ Verify trial-reminders cron end-to-end + CLIENT_EMAILS_ENABLED gate behavior.

### Batch 4 — Tier-1 own-network-of-choice ✅ DONE (71cbf00; onboarding-time choice still dovetails the future Day-1 wizard — default instagram + settings selector for now)
- ☐ `locations.settings.ownSocialNetwork` (jsonb, default instagram, set at
  onboarding handle-confirm; dovetails social-handle-completion-plan Batch 3).
- ☐ Tier config SPLIT: `ownSocialNetworks` (entry: chosen-one; mid/top: all 3) vs
  `competitorSocialNetworks` (all tiers: all 3) in billing/tiers.ts + dossier/types.ts
  + every consumer.
- ☐ Enforce at collection (social pipeline): own profiles on paid entry pull only
  the chosen network; competitors unchanged.
- ☐ Dossier/skills own-account guidance via chosen network; settings UI to change it
  (adhoc re-pull, honest history-starts-fresh copy); upsell seam: detected non-chosen
  own network shows "found — tracked on Tier 2+".

### Batch 5 — trial = one location, explicitly ✅ DONE (d284e16)
- ☐ Explicit isTrialing gate on add-location paths + account flyout upsell copy;
  paid limits 1/1/3 reconciled across both tier tables.

### Batch 6 — sweep, verify, deploy, migrate ✅ DONE (2026-06-11)
Gates: tsc clean · 207/207 unit tests · prod build 70/70. Deployed: main FF
35c73f7→a7199fc, Production row **Ready** (48s), getticket.ai 200. Migration
20260611190000_kill_free_tier.sql applied to BRANCH and PROD (Bryan's explicit
go): 9 free→mid (prod; 8 on branch), column default 'mid', schema-verified both;
Bush's Chicken = mid / clock-trial live. Post-deploy eval pass = Bryan's
walkthrough (new-signup checkout needs a real card in Stripe test/live).
- ☑ Repo-wide grep gate (clean; sidebar legacy-label + an OpenWeather pricing comment remain on purpose) (no live `free` tier values outside historical docs).
- ☑ Cost model note: trial COGS ≈ half a month of mid ≈ $50 = CAC (brief § Trial
  Strategy); paid entry economics unchanged by network-of-choice (competitor pulls
  dominate).
- ☐ tsc + unit tests (184+) + prod build green → commit spine-rewrite → FF main +
  push → verify Production deploy row.
- ☐ **Prod migration (authorized 2026-06-11, "deploy + migrate when green")**:
  `UPDATE organizations SET subscription_tier='mid' WHERE subscription_tier='free'`
  (9 rows — trials are OF Tier 2 now; expired ones stay blocked via null
  payment_state + past clock) + `ALTER COLUMN subscription_tier SET DEFAULT 'mid'`.
  NOTE: v1 said free→entry; trial-of-Tier-2 supersedes. Schema-verify after.
- ☐ Post-migration eval: Bush (mid trial: 5 competitors, all networks, daily brief),
  expired test orgs (blocked), internal top orgs (untouched), billing page states,
  new-signup walkthrough.
- ☐ Update docs + memory; session log.

### Decisions resolved (2026-06-11)
1. Trial = Tier 2 daily experience; paid Tier 1 stays weekly. (Bryan + Chris)
2. Paid maxLocations 1 / 1 / 3 — keep plan/dossier values. (Bryan)
3. The 6 internal `top` orgs: leave as-is. (Bryan)
4. Deploy + prod migration authorized when gates green. (Bryan)

### Execution notes
- Branch spine-rewrite → main FF = deploy. db-exec: scripts/audit/db-exec.mjs
  (branch autonomous, prod per the standing authorization above). Stripe env price
  IDs must exist for mid monthly in prod (STRIPE_PRICE_ID_{TICKET,NEAT}_MID_MONTHLY) —
  verify before deploy; onboarding checkout depends on them.

### Pre-deploy env check (2026-06-11)
- STRIPE_PRICE_ID_TICKET_* all present in prod (incl. MID monthly/annual).
- **STRIPE_PRICE_ID_NEAT_MID_\* MISSING in prod** — Neat-brand onboarding checkout would 500 until added (Ticket unaffected). Bryan: run scripts/stripe/setup or add the env vars before any Neat signup.
- CLIENT_EMAILS_ENABLED exists in prod (value unverified); trial reminders bypass it now, weekly digest still respects it.
