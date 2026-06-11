# Trial & Tier Model Correction Plan (2026-06-11)

Bryan's directive, verbatim intent: **"There is no such thing as a free tier."** There is a
**free TRIAL, and the trial is OF Tier 1.** Anand baked free-tier thinking into the whole tool
very early in GTM and it keeps causing problems. Correct the model everywhere:

- **Tier 1 (entry):** own social = **one network of the customer's choosing** (favoring /
  defaulting / surfacing Instagram first is fine). Competitor monitoring still covers **all
  networks we find for competitors** — own-account choice never limits competitor coverage.
- **Tier 2 (mid) / Tier 3 (top):** all three networks (as configured today).
- **Trial = Tier 1, single location.** No second location until converted to a paid plan;
  paid plans add locations per their tier limit.

## Audit findings (2026-06-11, prod + code)

- `"free"` as a tier value appears across **~25 files** (lib/billing, lib/jobs pipelines,
  stripe checkout/webhook/pricing, admin UI, dashboard layout/billing/actions, cron daily,
  onboarding) + **17 `?? "free"` defaults**.
- `lib/billing/tiers.ts` has a full `free` entry in TIER_LIMITS (Anand-era, Jan 28) —
  `socialPlatforms: ["instagram"]`, briefingCadence weekly_digest, etc. `entry` is ALSO
  instagram-only. The rewrite's own `lib/insights/dossier/types.ts` TIER table mirrors this
  (tier 1 = ["instagram"]).
- `lib/billing/trial.ts` already half-moved to the right model ("Stripe-native trial model,
  Apr 2026"): paid tiers gate on payment_state (incl. `trialing`); `free` is documented as a
  legacy pre-rollout state. But org creation still lands on `free` + trial_ends_at, so every
  real signup (e.g. Bush's) is a "free-tier" org.
- **`socialPlatforms` is enforced NOWHERE that matters**: collection pulls every verified
  handle regardless of tier (Bush's free-trial TikTok is pulled daily = Data365 spend), while
  the dossier's unrelated prefer-Instagram bug hides it (see Batch 0). The only real consumers
  are skill prompts (play-recommendation guidance).
- **Prod data**: 9 orgs `subscription_tier='free'` (payment_state null; mix of active-trial
  Bush + expired internal test orgs), 6 orgs `top` (the trial_ends=2099 internal accounts).
- Trial location count: free/entry maxLocations=1 already, but there is no explicit
  "trialing orgs cannot add locations" rule — it falls out of the tier limit only.

---

### Batch 0 — loadSocial masking bug ✅ DONE (2026-06-11, 35c73f7 deployed + live-verified)
- ☑ `lib/insights/dossier/build.ts` loadSocial: latest snapshot per (entity, platform),
  classify each, THEN pick per entity — **usable beats unusable** (a dead Instagram must
  never mask a live TikTok — the Bush's Forney case found in Bryan's review), newest
  content_as_of wins among usable, Instagram only as the tiebreak between equals.
- ☑ Extract the selection into a pure exported helper (pickSocialSnapshot, 5 unit tests; Bush brief rebuilt → Social "3 active accounts", was "no recent activity"); unit-test the dead-IG+live-TikTok
  case explicitly. Rebuild Bush's brief after deploy to confirm "Social: 1 active account"+
  TikTok-aware synthesis.

### Batch 1 — kill the free tier (model core)
- ☐ `SubscriptionTier` type: `entry | mid | top | suspended`. Delete the `free` TIER_LIMITS
  entry. Fix every `?? "free"` default → `?? "entry"` (17 sites; case-by-case sanity check).
- ☐ `trial.ts`: trial semantics = tier `entry` + (payment_state `trialing` OR trial_ends_at
  in future, pre-Stripe signups). Remove the `free` branch. Keep `suspended` override.
- ☐ Org creation (onboarding actions): new orgs = `subscription_tier='entry'` +
  trial_ends_at = now + TRIAL_DURATION_DAYS (current 14d clock), payment_state null until
  Stripe checkout.
- ☐ **Prod migration (GATED, Bryan sign-off)**: `update organizations set
  subscription_tier='entry' where subscription_tier='free'` (9 rows; expired trials stay
  expired → still blocked, identical behavior). Leads untouched. Check `subscription_tier`
  CHECK constraint / enum first; widen if needed.
- ☐ UI sweep: tierLabel maps ("Free" label → "Tier 1 (trial)" when trialing), billing page,
  upgrade buttons, admin org tables, trial banners/gates copy ("your trial of Tier 1").
- ☐ Cron daily gating: re-verify after the tier change (445bbf4 made trials daily — keep:
  trialing orgs get the DAILY experience; an evaluator who sees data move weekly churns).
- ☐ Stripe: checkout/webhook/pricing references to 'free'; confirm tier mapping + that
  conversion (checkout completion) flips payment_state and clears the internal trial clock.

### Batch 2 — Tier-1 own-network-of-choice
- ☐ Storage: `locations.settings.ownSocialNetwork` ("instagram" | "facebook" | "tiktok";
  jsonb — no DDL). Default **instagram**. Set during onboarding (dovetails with
  social-handle-completion-plan Batch 3 inline confirm: confirming a handle on network X =
  choosing X; if multiple found, suggest/surface Instagram first per Bryan).
- ☐ Tier config semantics SPLIT: `ownSocialNetworks` (entry: chosen-one; mid/top: all 3) vs
  `competitorSocialNetworks` (ALL TIERS: all 3). Update both tier tables (billing/tiers.ts +
  dossier/types.ts) and every consumer.
- ☐ Enforcement at collection (`lib/jobs/pipelines/social.ts` collect + discovery): OWN
  profiles — on entry/trial, pull only the chosen network (others remain stored as
  unverified/candidate rows, not collected = no Data365 spend); competitor profiles —
  unchanged, all networks. Cadence/billing knobs already per-profile.
- ☐ Dossier + skills: own-account guidance uses the chosen network + capability.liveChannels;
  competitor analysis uses everything collected.
- ☐ Settings UI: show the chosen network; allow changing it (change → enqueue adhoc social
  for the new network; honest copy that history starts fresh).
- ☐ Upsell seam: where a non-chosen own network is detected (discovery finds it) show it as
  "found — tracked on Tier 2+" rather than hiding it silently.

### Batch 3 — trial = one location, explicitly
- ☐ Add an explicit trialing gate to add-location paths (`locations/actions.ts`
  createLocationFromPlaceAction, onboarding create, /locations/new UI): trialing org →
  block with honest copy ("Trials cover one location. Convert to add more.") + upgrade CTA.
  (Today this only falls out of entry.maxLocations=1 — make the RULE explicit so changing
  tier limits later can't accidentally open multi-location trials.)
- ☐ Verify conversion unlocks: paid entry stays 1 location; mid 1; top 3 (per TIER_LIMITS —
  confirm these are the intended paid limits with Bryan; maxLocations differs between the
  two tier tables: billing says 1/1/?, dossier table says 1/1/3 — reconcile).
- ☐ Account flyout "Add a location": hide or upsell-style when trialing.

### Batch 4 — sweep, verify, recalibrate
- ☐ Repo-wide grep gate: no remaining `"free"` tier values / `free tier` strings outside
  historical docs (docs/engine-rewrite history may keep them with a note).
- ☐ Cost model (`lib/billing/cost-model.ts`): re-estimate per-client costs under
  own-1-network + competitor-all-networks (competitor pulls dominate; entry recurring cost
  changes little — re-verify tier pricing margins).
- ☐ Post-migration eval pass on all prod orgs: trial gates, brief builds, coverage rows,
  billing page rendering for entry-trialing / top / expired states.
- ☐ Update docs + memory; session log.

### Decisions for Bryan (flagged, not assumed)
1. **Trial brief cadence**: tiers.ts says entry briefingCadence='weekly_digest', but trials
   currently get daily data + daily briefs (your 445bbf4 call). Recommend: trial = daily
   experience (sell the product), paid entry = per config. Confirm.
2. **Paid maxLocations per tier**: 1 / 1 / 3 (dossier table) — confirm intended.
3. Existing 6 `top` internal orgs: leave as-is (recommended) or normalize.

### Execution notes for the next session
- Read memory `ticket-complete-picture-status` + this doc first. Branch: spine-rewrite →
  main FF = deploy (Bryan's word per deploy). Prod DDL/data-migration needs Bryan's explicit
  per-migration go. db-exec tool: scripts/audit/db-exec.mjs (branch ref autonomous, prod
  gated). 179 unit tests + tsc + build must stay green; eval-gate + ground-filter are the
  engine safety nets. The classifier blocks prod reads/writes without Bryan's explicit
  authorization in the prompt — batch the asks.
