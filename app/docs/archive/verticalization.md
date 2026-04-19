# Vatic Verticalization PRD

**Document status:** Draft v2.0 (updated with resolved decisions + codebase audit findings)
**Author:** Anand Iyer
**Last updated:** April 8, 2026
**Target branch:** `feature-verticalization` (new branch off `dev`)
**Chosen architecture:** Option C — Single codebase + VerticalConfig layer + shared database with `industry_type` column
**First new vertical:** Liquor stores (brand: Vatic Liquor)
**Codebase reference:** BLUEPRINT.md (March 22, 2026)
**Next.js version:** 16.1.5 (uses `proxy.ts`, not `middleware.ts`)

**Domain architecture (confirmed):**

| Vertical | App Dashboard | Marketing Landing Page |
|---|---|---|
| Restaurant | `restaurant.getvatic.com` | `getticket.ai` |
| Liquor Store | `liquor.getvatic.com` | `goneat.ai` |
| Parent Brand | `www.getvatic.com` | Portal / redirect |

---

## Table of Contents

1. [Context and Decision Summary](#1-context-and-decision-summary)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [Guiding Principles](#3-guiding-principles)
4. [Architecture Overview](#4-architecture-overview)
5. [Branching and Safety Strategy](#5-branching-and-safety-strategy)
6. [Phase 0 — Audit Confirmation and Prep](#6-phase-0--audit-confirmation-and-prep)
7. [Phase 1 — Schema Foundation](#7-phase-1--schema-foundation)
8. [Phase 2 — VerticalConfig System](#8-phase-2--verticalconfig-system)
9. [Phase 3 — Type System Generalization](#9-phase-3--type-system-generalization)
10. [Phase 4 — Onboarding Generalization](#10-phase-4--onboarding-generalization)
11. [Phase 5 — Subdomain Routing via proxy.ts](#11-phase-5--subdomain-routing-via-proxyts)
12. [Phase 6 — Email Templates and Admin](#12-phase-6--email-templates-and-admin)
13. [Phase 7 — Liquor Store Landing Page](#13-phase-7--liquor-store-landing-page)
14. [Phase 8 — Liquor Store Content Signal](#14-phase-8--liquor-store-content-signal)
15. [Phase 9 — Liquor Store Insight Rules](#15-phase-9--liquor-store-insight-rules)
16. [Phase 10 — AI Prompt Context Injection](#16-phase-10--ai-prompt-context-injection)
17. [Phase 11 — QA, Validation, Merge](#17-phase-11--qa-validation-merge)
18. [What Must Not Change](#18-what-must-not-change)
19. [Open Questions and Decisions Needed](#19-open-questions-and-decisions-needed)
20. [Rollout Plan](#20-rollout-plan)
21. [Appendix A — VerticalConfig Interface](#21-appendix-a--verticalconfig-interface)
22. [Appendix B — Restaurant and Liquor Configs (Initial)](#22-appendix-b--restaurant-and-liquor-configs-initial)

---

## 1. Context and Decision Summary

Vatic (formerly Prophet) is a competitive intelligence platform for local businesses. It has been built from the ground up for restaurants as the first modeling reference, and is now approaching production readiness.

On April 6, 2026, the team agreed that liquor stores will be the next vertical. Chris validated the concept with Hunter (external contact), and the liquor store market opens a two-sided revenue opportunity (operator SaaS on one side, brand/distributor intelligence on the other) that restaurants do not.

The team also decided in that meeting to proceed with a single codebase and single database, segmented by an `industry_type` column, with branded subdomains providing the vertical-specific experience. The verticalization PPT completed on April 7 formalized this as Option C and mapped the full codebase audit.

This PRD is the implementation roadmap for Option C. It is written to be compatible with the current `feature-anand` branch state as documented in BLUEPRINT.md (March 22, 2026) and to ship a working liquor store vertical without breaking the existing restaurant vertical.

**Domain architecture note:** Each vertical gets two domains — an app dashboard domain under `*.getvatic.com` and a separate marketing domain for the branded landing page. The restaurant vertical will be served at `restaurant.getvatic.com` (app) and `getticket.ai` (marketing). The liquor vertical will be served at `liquor.getvatic.com` (app) and `goneat.ai` (marketing). The parent brand at `www.getvatic.com` serves as a portal or redirect. All five domains point to a single Vercel deployment.

The guiding assumption is simple. We are not forking the codebase. We are generalizing it. Everything that currently reads the word "restaurant" needs to either become neutral or read from a vertical config. Restaurant-specific logic that is genuinely restaurant-only (the menu extraction prompt, the 8 content insight rules, cuisine list) gets moved into a `verticals/restaurant` module, and liquor gets a parallel `verticals/liquor-store` module. The shared layer does everything else.

## 2. Goals and Non-Goals

### 2.1 Goals

1. Ship a working Vatic Liquor vertical on `liquor.getvatic.com` (app) and `goneat.ai` (marketing) with a branded landing page, onboarding flow, and dashboard. Simultaneously move the restaurant vertical to `restaurant.getvatic.com` (app) and `getticket.ai` (marketing).
2. Keep the existing restaurant vertical (served at the current primary domain) fully functional with zero user-visible regressions.
3. Make future verticals (car dealerships, retail, etc.) a matter of adding a new `VerticalConfig` and a content-signal module, not a codebase rewrite.
4. Maintain a single deployment, single database, single admin dashboard, single cron orchestrator, and single billing stack.
5. Preserve the ability to sell or legally isolate a vertical in the future by keeping all data queryable by `industry_type`.
6. Keep all changes additive at the database level. No destructive migrations.

### 2.2 Non-Goals

1. Multiple deployments or separate Supabase projects. If we need that later, we can do it as a separate project.
2. A Turborepo monorepo split. Option B is a future project, not this one.
3. Cross-vertical data mixing in the UI. A liquor store user never sees a restaurant location or vice versa.
4. Changing the billing tiers, Stripe products, or trial period logic. Tiers remain shared across verticals for v1.
5. Replacing the admin dashboard with a per-vertical admin. The admin stays unified but gains an `industry_type` filter.
6. Migrating off the `feature-anand` branch naming convention. We create a new branch alongside.

## 3. Guiding Principles

These come from the verticalization PPT and the meeting notes, and they anchor every decision in the phases below.

1. **Speed to market.** Liquor is ready now. The architecture must not block a fast first deployment. Every phase is designed to be shippable independently.
2. **Maintainability first.** One engineering team. Every diverging code path is a future cost.
3. **Data separability, not data isolation.** We keep everything in one database, but we never let a query run without an `industry_type` filter that belongs there. This preserves our ability to export or legally separate a vertical cleanly.
4. **Additive, not destructive.** Every DB migration is additive. Every new file is additive. Existing files are edited to read from config, not replaced.
5. **Brand differentiation via config and subdomain.** Subdomain → industry_type → VerticalConfig → UI copy, landing page, onboarding, prompts, insight rules.
6. **Signal toggles to protect cost.** Not every signal is relevant for every vertical. The vertical config can enable or disable signals to prevent wasteful API spend.
7. **Nothing ships without the existing restaurant path passing an end-to-end check.** The restaurant vertical is our regression benchmark.

## 4. Architecture Overview

```
                         ┌──────────────────────────────┐
                         │   Vercel Single Deployment    │
                         └──────────────┬───────────────┘
                                        │
    ┌───────────────────┬───────────────┼───────────────┬───────────────────┐
    │                   │               │               │                   │
restaurant.         liquor.         getticket.ai    goneat.ai       www.getvatic.com
getvatic.com       getvatic.com     (marketing)    (marketing)     (parent brand
(restaurant app)   (liquor app)                                     portal)
    │                   │               │               │                   │
    └───────────────────┴───────────────┼───────────────┴───────────────────┘
                                        │
                         ┌──────────────▼───────────────┐
                         │          proxy.ts            │
                         │  1. host → industry_type     │
                         │  2. Supabase session refresh  │
                         │  → x-vatic-vertical header   │
                         └──────────────┬───────────────┘
                                        │
                         ┌──────────────▼───────────────┐
                         │   App Router + VerticalCtx   │
                         │   useVertical() / getVert()  │
                         └──────────────┬───────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
        VerticalConfig           Shared Signals          Vertical-specific
        (labels, copy,           (Competitor,             modules
         categories,             SEO, Events,             (restaurant/,
         emojis)                 Social, Photos,          liquor-store/)
                                 Traffic, Weather)         - content extractor
                                                           - content insight rules
                                                           - category config
                                        │
                         ┌──────────────▼───────────────┐
                         │   Shared Supabase Database   │
                         │   organizations.industry_    │
                         │   type = 'restaurant' |      │
                         │   'liquor_store'             │
                         └──────────────────────────────┘
```

**Proxy host-to-vertical mapping:**

| Host | industry_type | Context |
|---|---|---|
| `restaurant.getvatic.com` | `restaurant` | Restaurant app dashboard |
| `getticket.ai` | `restaurant` | Restaurant marketing landing page |
| `liquor.getvatic.com` | `liquor_store` | Liquor store app dashboard |
| `goneat.ai` | `liquor_store` | Liquor store marketing landing page |
| `www.getvatic.com` | n/a | Parent brand portal (redirects or shows vertical picker) |
| `localhost:3000` | `restaurant` (default) | Local development fallback |

Request flow:
1. User visits `liquor.getvatic.com/onboarding` or `goneat.ai`.
2. `proxy.ts` reads the host header, maps it to `industry_type = 'liquor_store'`, sets the `x-vatic-vertical` response header, and also refreshes the Supabase auth session cookie (dual-purpose proxy).
3. Every server component can call `getVerticalFromRequest()` to get the config for this request, or fall back to the user's org `industry_type` if authenticated.
4. All labels, copy, category lists, emojis, and feature toggles come from `getVerticalConfig(industryType)`.
5. Pipelines run against `lib/verticals/<industry_type>/` for content extraction and insight rules. Everything else is shared.
6. RLS policies continue to work exactly as they do today (org-scoped), because data isolation between users was never the problem verticalization was solving. Industry filtering is a query-level concern, not an RLS concern.
7. Marketing domains (`getticket.ai`, `goneat.ai`) serve the landing page. App domains (`*.getvatic.com`) serve the dashboard. Both are the same Next.js deployment — the proxy injects the vertical, and `app/page.tsx` (landing) reads it to display the right brand.

## 5. Branching and Safety Strategy

This is the part I want to be most careful about. The current `feature-anand` branch is ahead on admin experience work, and we do not want to risk anything there.

### 5.1 Branch Plan

1. Merge `feature-anand` into `dev` first if not already merged (admin deletion work + waitlist gate). This establishes a clean base.
2. Create `feature-verticalization` off `dev`.
3. All verticalization work happens on `feature-verticalization`.
4. During development, the liquor store vertical is tested via a Vercel preview deployment. The preview URL gets the liquor subdomain mapped via Vercel domain config, or we use a query parameter override (`?vertical=liquor_store`) in dev mode only.
5. When Phase 11 passes, `feature-verticalization` merges into `dev`, then `dev` → `main` as usual.

### 5.2 Safety Rails

1. **Feature flag.** Add a `VERTICALIZATION_ENABLED` env var defaulting to `false` in production until Phase 5 is done. When false, the proxy's vertical detection is a no-op and everything reads `industry_type = 'restaurant'` as the fallback. (The Supabase session refresh portion of the proxy runs regardless of the flag.)
2. **Backfill first, enforce later.** The `industry_type` column is added as nullable with a default of `'restaurant'`, backfilled, and only then made `NOT NULL`. This means no existing row can be missing an industry.
3. **Restaurant regression checklist.** Before every merge back to `dev`, run through a manual checklist covering: restaurant onboarding flow end to end, each signal pipeline, each dashboard page, priority briefing, trial emails, Stripe checkout. Playwright smoke test stays green.
4. **Database migrations stay additive.** No `DROP`, no `ALTER TYPE`, no column renames. If we rename a TS type, the underlying column keeps its old name.
5. **The `VerticalConfig` for restaurant is authored first and must pass a test that says the rendered restaurant experience is byte-equivalent to the current one.** In practice this means: copy every string we are replacing, paste it into the restaurant config, and verify the UI renders identically.

### 5.3 What Could Break and How We Prevent It

| Risk | Prevention |
|---|---|
| `industry_type` missing on existing orgs after migration | Migration backfills `'restaurant'` in the same transaction as the column add |
| Proxy breaks existing routes | Proxy vertical detection is guarded by `VERTICALIZATION_ENABLED`; also has a dev-only bypass via `?vertical=` query param |
| Restaurant copy accidentally deleted instead of moved | All copy moves through a two-commit process: first copy into `verticals/restaurant/config.ts`, second commit removes the hardcoded string and reads from config. Commits are reviewable in isolation |
| `'use cache'` invalidation behaving differently per vertical | Cache tags are per-location, not per-vertical. No change needed |
| Supabase RLS interfering with cross-vertical admin queries | Admin dashboard uses service-role admin client, bypasses RLS. No change needed |
| Stripe price IDs need per-vertical variants | Phase 1 decision: initial launch uses the same Stripe price IDs for both verticals. Per-vertical pricing is a Phase 2 discussion |
| Existing tests fail | Tests are updated in the same PR as the refactor. Playwright smoke test gets a `vertical=restaurant` and `vertical=liquor_store` variant |

## 6. Phase 0 — Audit Confirmation and Prep

Before writing any code, we confirm the audit holds and set up the branch.

**Duration estimate:** 0.5 day

**Tasks:**

1. Merge any pending work on `feature-anand` → `dev`. Confirm Playwright passes on `dev`.
2. Create `feature-verticalization` off `dev`. Push to GitHub.
3. Re-run a quick grep audit against the branch to catch anything BLUEPRINT.md missed. Specifically grep for:
   - `restaurant` (case-insensitive) in `app/`, `lib/`, `components/`
   - `menu` in `lib/content/`, `lib/ai/`, `app/onboarding/`
   - `cuisine` everywhere
   - `dine_in`, `happy_hour`, `catering`, `kids` (the `MenuType` values)
   - `DoorDash`, `Grubhub`, `UberEats`
4. Save the grep output to `docs/audit/verticalization-grep.txt` in the branch as a reference for what still needs to move.
5. Verify the dev environment runs the app cleanly at the pinned Next.js 16.1.5 and Tailwind v4 versions documented in BLUEPRINT.md section 2.

**Exit criteria:** Branch exists, grep results captured, dev environment runs.

## 7. Phase 1 — Schema Foundation

Minimum-risk additive database migration.

**Duration estimate:** 0.5 day

**Migration file:** `supabase/migrations/20260409010100_add_industry_type.sql`

**What it does:**

```sql
-- Phase 1: Add industry_type to organizations
-- Additive, no destructive changes

-- 1. Add column as nullable with restaurant default
ALTER TABLE organizations
  ADD COLUMN industry_type text DEFAULT 'restaurant';

-- 2. Backfill all existing rows (should be a no-op given default, but explicit)
UPDATE organizations
SET industry_type = 'restaurant'
WHERE industry_type IS NULL;

-- 3. Enforce NOT NULL after backfill
ALTER TABLE organizations
  ALTER COLUMN industry_type SET NOT NULL;

-- 4. Add CHECK constraint for known verticals
ALTER TABLE organizations
  ADD CONSTRAINT organizations_industry_type_check
  CHECK (industry_type IN ('restaurant', 'liquor_store'));

-- 5. Index for vertical-filtered queries
CREATE INDEX idx_organizations_industry_type
  ON organizations(industry_type);

-- 6. Optional: vertical_config JSONB for per-org overrides
-- Not required for v1 but cheap to add now
ALTER TABLE organizations
  ADD COLUMN vertical_config jsonb DEFAULT '{}'::jsonb;
```

**Notes:**

- We use a text column with a CHECK constraint rather than a Postgres ENUM. ENUMs require a migration to add values, which is more painful than adding a string to a CHECK. This matches Q8 from the audit PPT and is the more flexible option.
- `vertical_config` JSONB is included even though we will not use it in v1. It is free to add now and expensive to add later. Future features like per-org signal toggles live here.
- RLS policies on `organizations` do not need to change. They are user-scoped via membership, not vertical-scoped.
- Regenerate `types/database.types.ts` from Supabase after applying.

**Exit criteria:** Migration applied, types regenerated, every existing org row has `industry_type = 'restaurant'`.

## 8. Phase 2 — VerticalConfig System

This phase introduces the abstraction without touching any user-facing code yet.

**Duration estimate:** 1 day

**New files:**

```
lib/verticals/
├── types.ts                    # VerticalConfig interface
├── index.ts                    # getVerticalConfig(), VERTICALS registry
├── restaurant/
│   ├── config.ts               # Full restaurant VerticalConfig (current app copy)
│   ├── constants.ts            # CUISINES[], menu patterns, promo keywords (moved from current hardcoded locations)
│   └── index.ts                # Barrel export
└── liquor-store/
    ├── config.ts               # Full liquor store VerticalConfig
    ├── constants.ts            # STORE_TYPES[], spirit categories, liquor promo keywords
    └── index.ts                # Barrel export
```

**The VerticalConfig interface is defined in detail in Appendix A.** The short version: it has labels (business noun, competitor noun, setup CTA), category lists (cuisines or store types), emoji maps for category icons, landing page copy, onboarding copy, and signal toggles.

**Tasks:**

1. Write `lib/verticals/types.ts` with the `VerticalConfig` interface (Appendix A).
2. Write `lib/verticals/restaurant/config.ts` by copying every currently hardcoded restaurant string out of the codebase into a single structured object. This file is the single source of truth for restaurant labels. This is purely a move, not a logic change.
3. Write `lib/verticals/restaurant/constants.ts` and move `CUISINES[]`, the promo keywords list, and any food tag lists.
4. Write `lib/verticals/liquor-store/config.ts` and `constants.ts` as parallel structures. Use the liquor content from the verticalization PPT as the source (bourbon, scotch, tequila, etc.). Copy is marked "Draft - needs Bryan review" so we know what to replace before launch.
5. Write `lib/verticals/index.ts` with:
   ```typescript
   export const VERTICALS = {
     restaurant: restaurantConfig,
     liquor_store: liquorStoreConfig,
   } as const

   export type IndustryType = keyof typeof VERTICALS

   export function getVerticalConfig(industryType: IndustryType): VerticalConfig {
     return VERTICALS[industryType] ?? VERTICALS.restaurant
   }
   ```
6. No consumers yet. This phase is pure scaffolding.

**Exit criteria:** Both configs compile and type-check. `getVerticalConfig('restaurant')` and `getVerticalConfig('liquor_store')` both return complete objects. Nothing else in the app has changed.

## 9. Phase 3 — Type System Generalization

The verticalization PPT flagged this as the most critical and most hardcoded layer. The fix is simpler than it looks because no database migration is required.

**Duration estimate:** 2.5 days (revised up from 1.5 — codebase audit found deeper coupling than originally estimated)

**Target files (from blueprint + codebase audit):**

- `lib/content/types.ts` — `MenuType`, `MenuItem.tags`, `DetectedFeatures`, `CorePage.type`
- `lib/content/normalize.ts` — `detectFeatures()`
- `lib/content/menu-parse.ts` — `classifyMenuCategory()`
- `lib/content/enrich.ts` — `enrichCompetitorContent()`
- `lib/content/insights.ts` — 8 content rules (moves to vertical module in Phase 9)
- `components/content/menu-viewer.tsx` — renders `MenuCategory[]` and `MenuItem[]` types directly; needs to accept generic `CatalogCategory[]` (audit found this was missing from the original target list)
- `components/content/menu-compare.tsx` — same coupling as `menu-viewer.tsx`
- `app/(dashboard)/content/page.tsx` — references "restaurant" in 2 places, uses `MenuSnapshot` types
- `lib/jobs/pipelines/content.ts` — pipeline orchestrator; needs vertical dispatch point for extractor and discovery terms

**Strategy:** We do not delete the restaurant-specific types. We rename them to make their scope explicit and introduce generic parallels.

1. Rename `MenuType` → `RestaurantMenuType` in `lib/verticals/restaurant/types.ts`. Leave a deprecated re-export in `lib/content/types.ts` so nothing breaks.
2. Introduce `CatalogItem`, `CatalogCategory`, `CatalogSnapshot` as the generic parallels to `MenuItem`, `MenuCategory`, `MenuSnapshot` in `lib/content/types.ts`. Restaurant menu types become a subtype of catalog types.
3. Introduce `DetectedFeatures` as a polymorphic interface:
   ```typescript
   interface FeatureDefinition {
     key: string
     label: string
     detectedFromPatterns: string[]
   }
   interface DetectedFeatures {
     [key: string]: boolean
   }
   ```
   The restaurant config exports its `FeatureDefinition[]` (reservations, private dining, catering, online ordering, DoorDash, Grubhub, UberEats), and liquor exports its own (curbside pickup, home delivery, loyalty program, Drizly, Instacart).
4. Rewrite `detectFeatures()` in `lib/content/normalize.ts` to take a `FeatureDefinition[]` parameter and run pattern matching based on that, instead of having hardcoded reservation/catering/deliveryPlatforms checks. Call sites pass `getVerticalConfig(industryType).contentFeatures`.
5. `CorePage.type` becomes `string` with a config-driven validation set. Each vertical's config lists its expected core pages (restaurants: menu, reservations, catering, about; liquor: products, delivery, events, about).
6. `classifyMenuCategory()` in `lib/content/menu-parse.ts` gets renamed to `classifyCatalogCategory()` and takes the vertical's category list from config. The restaurant version keeps its `dine_in/catering/happy_hour/kids/other` logic but only runs when `industryType === 'restaurant'`.

**Guardrail:** At the end of this phase, the restaurant content pipeline must still produce byte-equivalent output for a test fixture. We add a regression test under `tests/content-regression.spec.ts` that asserts this.

**Exit criteria:** TypeScript compiles clean. Restaurant content pipeline still works end to end. No user-visible change.

## 10. Phase 4 — Onboarding Generalization

The audit identifies onboarding as the most concentrated user-facing hardcoded layer.

**Duration estimate:** 1 day

**Target files:**

- `app/onboarding/page.tsx`
- `app/onboarding/onboarding-wizard.tsx`
- `app/onboarding/steps/splash.tsx`
- `app/onboarding/steps/restaurant-info.tsx` → rename to `business-info.tsx`
- `app/onboarding/steps/competitor-selection.tsx`
- `app/onboarding/steps/intelligence-settings.tsx`
- `app/onboarding/steps/loading-brief.tsx`
- `app/onboarding/actions.ts`

**Strategy:**

1. The wizard receives a `verticalConfig` prop from the page. The page reads `industry_type` from either (a) the middleware-injected request header if unauthenticated, or (b) the user's org record if authenticated and resuming.
2. Rename `restaurantName` → `businessName` in all form state and action signatures. Keep the DB field the same (`locations.name`).
3. Replace `CUISINES[]` import with `verticalConfig.businessCategories`.
4. Replace every hardcoded string in the 5 step components with `verticalConfig.onboarding.<stepKey>.<stringKey>`. Examples:
   - `"Set up my restaurant"` → `verticalConfig.onboarding.splash.ctaLabel`
   - `"Searching for nearby restaurants..."` → `verticalConfig.onboarding.competitors.searchingLabel`
   - `"We found nearby restaurants"` → `verticalConfig.onboarding.competitors.foundLabel`
   - `"Get alerted when new restaurants open"` → `verticalConfig.onboarding.settings.newCompetitorLabel`
5. Replace food emojis with `verticalConfig.categoryEmojis`.
6. `createOrgAndLocationAction` in `app/onboarding/actions.ts` accepts an `industryType` parameter and writes it to `organizations.industry_type` on creation.
7. `discoverCompetitorsForLocation` also accepts `industryType` and passes it to the Gemini provider so the grounding prompt uses the right business noun.
8. Google Places API `type` parameter: restaurant onboarding currently uses `type=restaurant` in the Places API call for nearby competitor discovery. Liquor store needs `type=liquor_store`. The `VerticalConfig` should include a `placesApiType: string` field that maps to the Google Places API type for each vertical.

**Guardrail:** The restaurant onboarding flow must visually match the current flow pixel-for-pixel when `verticalConfig = restaurantConfig`. We take a screenshot before the phase and after, and diff them.

**Exit criteria:** Both restaurant and liquor store onboarding flows render correctly when switched via a query parameter override (`?vertical=liquor_store`). No database writes fail. No regressions on the restaurant path.

## 11. Phase 5 — Subdomain Routing via proxy.ts

This is the phase where vertical selection becomes real for end users.

**Duration estimate:** 1 day

**New file:** `proxy.ts` at the repo root

**Important: Next.js 16.1.5 uses `proxy.ts` instead of `middleware.ts`.** The blueprint explicitly notes there is no proxy today (BLUEPRINT §6.4 and §21 limitation #4), so we are adding one. The proxy serves dual purposes: (1) vertical detection from hostname and (2) Supabase auth session cookie refresh on every request.

```typescript
// proxy.ts — Next.js 16 proxy (replaces middleware.ts convention)
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const HOST_TO_VERTICAL: Record<string, string> = {
  // App dashboard domains
  'restaurant.getvatic.com': 'restaurant',
  'liquor.getvatic.com': 'liquor_store',
  // Marketing landing page domains
  'getticket.ai': 'restaurant',
  'goneat.ai': 'liquor_store',
  // Future:
  // 'auto.getvatic.com': 'car_dealership',
}

const DEFAULT_VERTICAL = 'restaurant'

export function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  // ── 1. Supabase session refresh (always runs) ──
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )
  // getUser() triggers the session refresh; we await it
  supabase.auth.getUser()

  // ── 2. Vertical detection (guarded by feature flag) ──
  if (process.env.VERTICALIZATION_ENABLED === 'true') {
    const host = request.headers.get('host')?.toLowerCase() ?? ''
    const hostWithoutPort = host.split(':')[0]

    // Dev override via query param
    const devVertical = request.nextUrl.searchParams.get('vertical')
    const vertical =
      (process.env.NODE_ENV !== 'production' && devVertical) ||
      HOST_TO_VERTICAL[hostWithoutPort] ||
      DEFAULT_VERTICAL

    response.headers.set('x-vatic-vertical', vertical)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Server-side helper:**

```typescript
// lib/verticals/server.ts
import { headers } from 'next/headers'
import { getVerticalConfig, type IndustryType } from '@/lib/verticals'

export async function getVerticalFromRequest(): Promise<IndustryType> {
  const h = await headers()
  const v = h.get('x-vatic-vertical') as IndustryType | null
  return v ?? 'restaurant'
}

export async function getVerticalConfigFromRequest() {
  const vertical = await getVerticalFromRequest()
  return getVerticalConfig(vertical)
}
```

**Resolution priority when a user is authenticated:** user's org `industry_type` wins over the host header. This matters if someone logs into `liquor.getvatic.com` with a restaurant account (we redirect them to `restaurant.getvatic.com` in that case).

**DNS and Vercel:**

1. Add all five domains as custom domains on the single Vercel deployment:
   - `restaurant.getvatic.com` (app — restaurant)
   - `liquor.getvatic.com` (app — liquor)
   - `getticket.ai` (marketing — restaurant)
   - `goneat.ai` (marketing — liquor)
   - `www.getvatic.com` (parent brand portal)
2. Verify SSL provisioning for all domains.
3. All domains are in the `HOST_TO_VERTICAL` map in `proxy.ts`.
4. Confirm that the preview branch's assigned preview URL continues to default to `restaurant`.
5. `www.getvatic.com` serves a parent brand page or redirects to a vertical picker. Not required for v1 launch — can start as a simple redirect to `restaurant.getvatic.com`.

**Exit criteria:** Visiting `liquor.getvatic.com` (or equivalent preview) shows the onboarding/landing experience routed with `industry_type = 'liquor_store'`. Visiting `restaurant.getvatic.com` shows the unchanged restaurant experience. Marketing domains (`getticket.ai`, `goneat.ai`) show the correct branded landing pages. The `VERTICALIZATION_ENABLED` flag can still turn vertical detection off instantly (Supabase session refresh continues to work regardless).

## 12. Phase 6 — Email Templates and Admin

**Duration estimate:** 0.5 day

**Email templates** (`lib/email/templates/`):

Only one template has restaurant-specific copy according to the audit: `welcome.tsx`. The fix is to read the vertical from the org at send time and pass a `verticalConfig` prop into the template.

1. Update `lib/email/send.ts` callers to pass `industryType` where relevant. For welcome/trial/waitlist emails, look up the org's industry.
2. `welcome.tsx` reads `verticalConfig.emailCopy.welcome` for the headline and intro, and `verticalConfig.businessLabel` for nouns.
3. `waitlist-invitation.tsx` and `waitlist-confirmation.tsx` get a small refactor so the subject line and body reference "your dashboard" rather than anything food-specific (they were already generic per the blueprint, but we double-check).
4. Admin notification emails do not need changes.

**Admin dashboard:**

1. Add `industry_type` as a filter on `/admin/organizations` and `/admin/users` tables.
2. Add `industry_type` as a column in the org table view.
3. On waitlist approval (`actions/waitlist.ts`), the created org inherits the `industry_type` from the waitlist signup's source. The admin can override this during approval if needed (e.g., a user signed up on the wrong subdomain). This requires adding an `industry_type` column to `waitlist_signups` as well.

**`industry_type` determination flow (confirmed decision — Q3):**
- **Primary:** Subdomain detection in `proxy.ts` — the waitlist form reads the injected vertical from the request header and writes it to `waitlist_signups.industry_type`.
- **Fallback:** Admin can override `industry_type` on the waitlist approval screen if the automatic detection was wrong.
- **No user self-select:** Users never pick their industry type themselves; it's always derived from which domain they signed up on.

**Additional migration:** `supabase/migrations/20260409010200_waitlist_industry_type.sql`

```sql
ALTER TABLE waitlist_signups
  ADD COLUMN industry_type text DEFAULT 'restaurant';

UPDATE waitlist_signups
SET industry_type = 'restaurant'
WHERE industry_type IS NULL;

ALTER TABLE waitlist_signups
  ALTER COLUMN industry_type SET NOT NULL;

ALTER TABLE waitlist_signups
  ADD CONSTRAINT waitlist_signups_industry_type_check
  CHECK (industry_type IN ('restaurant', 'liquor_store'));

CREATE INDEX idx_waitlist_signups_industry_type
  ON waitlist_signups(industry_type);
```

The homepage waitlist form reads the proxy-injected vertical (from the `x-vatic-vertical` header) and writes the matching `industry_type` on insert.

**Exit criteria:** Admin can filter by vertical. Waitlist signups on `liquor.vatic.ai` get `industry_type = 'liquor_store'`. When an admin approves them, the created org inherits that vertical. Welcome email uses the right copy.

## 13. Phase 7 — Liquor Store Landing Page

**Duration estimate:** 1.5 days

The existing landing page at `app/page.tsx` is restaurant-specific. We have two domain pairs to serve:

| Domain | Vertical | Content |
|---|---|---|
| `getticket.ai` | restaurant | Restaurant-branded landing page |
| `goneat.ai` | liquor_store | Liquor-branded landing page |
| `restaurant.getvatic.com` | restaurant | App dashboard (authenticated) |
| `liquor.getvatic.com` | liquor_store | App dashboard (authenticated) |

Since marketing pages (`getticket.ai`, `goneat.ai`) and app dashboards (`*.getvatic.com`) are all served by the same Next.js deployment, we have two options:

- **Option A — Parameterize the existing landing page.** All copy, SVG category labels, and hero content read from `verticalConfig.landing`. One file, two verticals. Lower maintenance, less brand differentiation.
- **Option B — Create separate page files.** Separate landing page components per vertical for full design freedom.

**Recommendation:** Start with Option A for v1 to ship fast. If the liquor brand needs significant visual divergence (different color palette, different layout entirely), we split into Option B in a later phase. Bryan can sign off on this choice.

**Tasks (assuming Option A):**

1. Extract all hardcoded strings in `app/page.tsx` and `app/landing.css` into `verticalConfig.landing`.
2. The animated SVG dashboard visualization should parameterize category labels (food types → spirit types).
3. The 6-feature bento grid reads feature descriptions from `verticalConfig.landing.features[]`.
4. The pricing section remains shared. Same tiers for both verticals in v1.
5. The trust counters, the problem statement, and the how-it-works sections all read their copy from config.
6. Waitlist form on the liquor landing calls the same `POST /api/waitlist` endpoint but the proxy-injected vertical is written to the row.

**Copy needed from Bryan:** liquor store hero headline, subheadline, problem statement, and 6 feature descriptions. Draft copy goes into `verticals/liquor-store/config.ts` marked "Draft - needs Bryan review" and gets replaced before launch.

**Exit criteria:** Visiting `goneat.ai` shows a liquor-branded landing page. Visiting `getticket.ai` shows the restaurant landing page. Both domains resolve correctly via the proxy.

## 14. Phase 8 — Liquor Store Content Signal (Sprint 2)

> **Decision (Q4 resolved):** This phase is deferred to Sprint 2 (post-launch). The liquor vertical launches with all shared signals (competitor, SEO, events, social, photos, traffic, weather) but **without** the liquor-specific content extraction pipeline. This saves ~2 days and de-risks the initial launch. The content signal config toggle in `VerticalConfig.signals.content` is set to `false` for liquor_store in Sprint 1.

This is the only pipeline that requires new code beyond config.

**Duration estimate:** 2 days (Sprint 2)

**New files:**

```
lib/verticals/liquor-store/
├── content/
│   ├── types.ts                # LiquorCatalogItem, LiquorCatalogCategory
│   ├── extract.ts              # Gemini prompt for liquor catalog extraction
│   ├── patterns.ts             # Promo keywords, category patterns
│   └── features.ts             # FeatureDefinition[] for liquor (curbside, delivery, Drizly, etc.)
```

**The Gemini prompt:** Replaces the current restaurant menu extraction prompt in `lib/ai/gemini.ts` when `industry_type === 'liquor_store'`. Extracts:

- Spirit type: bourbon, scotch, tequila, vodka, gin, rum, brandy, liqueur, wine, beer
- Brand and distillery
- Bottle sizes: 50ml, 200ml, 375ml, 750ml, 1L, 1.75L
- Price per size
- ABV / proof
- Age statement (for whiskeys)
- Country of origin
- Promotional vs regular pricing flag
- Inventory / "in stock" signal if visible

**Pipeline integration:** `lib/jobs/pipelines/content.ts` stays as the orchestrator but dispatches to the vertical's content module based on the location's org's `industry_type`. In Sprint 1, the content pipeline checks `verticalConfig.signals.content` and early-returns with a no-op for liquor locations:

```typescript
const vertical = getVerticalForLocation(locationId)
const config = getVerticalConfig(vertical)

// Sprint 1: content signal disabled for liquor — early return
if (!config.signals.content) return { skipped: true, reason: 'content signal disabled for vertical' }

// Sprint 2: dispatch to vertical-specific extractor
const extractor = vertical === 'liquor_store'
  ? liquorCatalogExtractor
  : restaurantMenuExtractor
```

**Firecrawl discovery terms:** The search terms used by `discoverAllMenuUrls()` need to become vertical-specific. Restaurants search for "menu", "catering", "order online". Liquor stores search for "products", "spirits", "wine", "beer", "shop", "catalog", "browse".

**Storage:** We continue to use the same `snapshots` and `location_snapshots` tables. The `raw_data` JSONB just contains a different shape based on the vertical. The `snapshot_type` value becomes vertical-prefixed (`restaurant_menu_weekly` vs `liquor_catalog_weekly`) so downstream consumers can distinguish.

**Exit criteria:** A liquor store location can trigger the content pipeline. It scrapes the website, extracts a product catalog, and stores it in `location_snapshots`. The restaurant path is untouched.

## 15. Phase 9 — Liquor Store Insight Rules (Sprint 2)

> **Depends on Phase 8.** Also deferred to Sprint 2 since catalog insight rules require the content pipeline to produce data.

**Duration estimate:** 1.5 days (Sprint 2)

**Move existing rules:** The 8 restaurant content insight rules currently live in `lib/content/insights.ts`. They move to `lib/verticals/restaurant/insights.ts` with no logic changes. A re-export from `lib/content/insights.ts` preserves any existing imports during the transition.

**New file:** `lib/verticals/liquor-store/insights.ts` with the 6 catalog insight rules from the verticalization PPT:

1. `catalog.price_positioning_shift` — competitor dropped/raised prices on comparable SKUs
2. `catalog.product_category_gap` — competitor carries a spirit category we don't
3. `catalog.promo_signal_detected` — promotional keywords in competitor catalog ("2 for $30", "case discount", "clearance")
4. `catalog.delivery_platform_gap` — competitor on Drizly/Instacart/GoPuff and we're not
5. `catalog.exclusive_product_detected` — competitor carries a rare or allocated bottle
6. `catalog.pricing_tier_gap` — competitor covers a price tier (premium/mid/budget) we don't

**Insight rules dispatcher:** `generateInsightsAction` in `app/(dashboard)/insights/actions.ts` reads the org's `industry_type` and calls the appropriate content insight generator. Everything else (SEO, events, photos, traffic, weather, social, visual, cross-signal) stays shared.

**Insight type registry:** Add the 6 new `catalog.*` types to whatever central list exists (insight type enums, UI labels, priority briefing diversity rules). Priority briefing's "must cover ≥ 3 source categories" rule should treat `catalog.*` as equivalent to `menu.*` for diversity purposes.

**Exit criteria:** A liquor store location with approved competitors generates catalog insights. Restaurant insights are untouched. Priority briefing works for both verticals.

## 16. Phase 10 — AI Prompt Context Injection

**Duration estimate:** 0.5 day

The audit called out that most Gemini prompts are already generic but would benefit from vertical context injection for higher-quality output.

**Target files:**

- `lib/ai/prompts/insights.ts` — `buildInsightNarrativePrompt()`
- `lib/ai/prompts/priority-briefing.ts` — `buildPriorityBriefingPrompt()`
- `lib/providers/gemini.ts` — competitor discovery prompt
- `lib/ai/prompts/prophet-chat.ts` — chat (scaffolded, not active, but design it right from the start)

**Change:** Every prompt builder accepts an `industryType: IndustryType` parameter and injects a vertical context phrase at the top of the prompt:

```typescript
const verticalContext = {
  restaurant: 'a local restaurant operator competing with other nearby restaurants',
  liquor_store: 'a local liquor store operator competing with other nearby liquor stores and alcohol retailers',
}[industryType]
```

This is a small change that compounds into meaningfully better LLM output.

**Exit criteria:** Both restaurant and liquor store priority briefings read naturally. No regressions in restaurant output quality.

## 17. Phase 11 — QA, Validation, Merge

**Duration estimate:** 1.5 days

**Restaurant regression test suite:**

1. Run the Playwright smoke test (`tests/auth-onboarding.spec.ts`). Must pass.
2. Manual walkthrough of restaurant onboarding end to end.
3. Manual walkthrough of every dashboard page on an existing restaurant location.
4. Trigger each pipeline individually and `refresh_all` for a restaurant location. All 9 pipelines complete.
5. Generate insights and verify the priority briefing still produces the same diversity.
6. Trigger the trial expiration email job and verify delivery.
7. Verify admin dashboard shows both verticals correctly filtered.

**Liquor store smoke test (Sprint 1 — no content signal):**

1. Sign up on `goneat.ai` waitlist (marketing domain).
2. Admin approves the signup; admin sees `industry_type = 'liquor_store'` on the waitlist entry.
3. New user receives liquor-branded welcome email.
4. User clicks magic link and arrives at `liquor.getvatic.com` (app domain).
5. User completes onboarding for a real liquor store with a real place ID and website.
6. AI discovers nearby liquor stores as competitors (Gemini grounding uses `placesApiType` from config).
7. User approves 3 competitors.
8. Trigger all shared signals (competitor, SEO, events, social, photos, traffic, weather). They all run successfully against a liquor store.
9. Content pipeline gracefully skips with `signals.content = false`.
10. Generate insights from shared signals. Priority briefing renders correctly.

**Liquor store content smoke test (Sprint 2 only):**

11. Enable `signals.content = true` for liquor_store.
12. Trigger content pipeline. Catalog extraction runs and returns structured data.
13. Generate insights. At least one `catalog.*` insight is produced.
14. Priority briefing includes catalog insights in diversity mix.

**Performance check:**

1. Query the `organizations` table with and without the `industry_type` filter. Confirm the index is being used (`EXPLAIN ANALYZE`).
2. Confirm no dashboard page got noticeably slower.

**Merge sequence:**

1. PR from `feature-verticalization` → `dev` with full test checklist in the PR description.
2. Code review (Henry + Bryan if applicable).
3. Merge to `dev`, deploy to preview.
4. Run the full checklist on the `dev` preview environment.
5. When green, PR from `dev` → `main`.
6. Set `VERTICALIZATION_ENABLED=true` in Vercel production env.
7. Add all production custom domains: `restaurant.getvatic.com`, `liquor.getvatic.com`, `getticket.ai`, `goneat.ai`, `www.getvatic.com`.
8. Announce soft launch internally.

**Exit criteria (Sprint 1):** Both verticals live in production on their respective domains. Restaurant and liquor store test walkthroughs passing. Content signal disabled for liquor.

**Exit criteria (Sprint 2):** Liquor content pipeline active. Catalog insights generating. Full feature parity across verticals.

## 18. What Must Not Change

A list I want to be explicit about, lifted directly from the verticalization PPT slide 12 and extended:

- Database schema for all 15+ existing tables beyond adding `industry_type`
- Billing tiers, Stripe products, Stripe webhook handling, trial period logic
- Auth flow (magic link, Google OAuth, auth callback route)
- Supabase RLS policies (they are org-scoped, which is correct)
- 7 of 8 intelligence signal pipelines: competitor, SEO, events, social, photos, traffic, weather
- The ~40+ generic insight rules across social, SEO, events, traffic, weather, photos
- Background job system, SSE streaming, `ActiveJobBar`, cron orchestrator
- Server-side caching (`'use cache'`, `cacheTag`, `cacheLife`, automatic revalidation)
- 5 of 6 email templates (only `welcome.tsx` gets a copy refresh)
- Multi-org support, org switcher, role system
- Insight card system, Kanban view, status workflow, optimistic updates
- Admin dashboard sections (they get filters, not rewrites)
- Any existing migration file (additive only)
- `refresh_jobs.job_type` CHECK constraint values (no new job types needed for liquor)
- The `proxy.ts` Supabase session refresh behavior (vertical detection is additive; the session refresh must work the same as if the proxy had always existed)

## 19. Open Questions and Decisions Needed

These come from the verticalization PPT slide 14 plus additional questions this PRD surfaced. Resolved questions are marked with their decision.

| Q | Question | Blocks Phase | Status | Decision |
|---|---|---|---|---|
| Q1 | Is liquor definitely the next vertical? Do we have a real test business? | Phase 0 | **RESOLVED** | Yes. Liquor is confirmed. A test store is ready. |
| Q2 | Branch naming: `feature-verticalization` okay, or do we want a different convention? | Phase 0 | Open | Anand to confirm |
| Q3 | How does `industry_type` get set at signup? | Phase 1, 5, 6 | **RESOLVED** | **Subdomain detection is primary** (proxy.ts reads host, injects vertical, waitlist form writes it). **Admin can override** on the waitlist approval screen. **No user self-select.** |
| Q4 | Can we ship without the content signal (Phase 8) and add it in sprint 2? | Phase 8 | **RESOLVED** | **Yes.** Launch without content signal. Phases 8 and 9 deferred to Sprint 2. Saves ~2 days. `VerticalConfig.signals.content = false` for liquor_store in Sprint 1. |
| Q5 | Waitlist form location: same form template, or fully separate design? Recommended: same form, different copy via config. | Phase 6, 7 | Open | Bryan to confirm |
| Q6 | Pricing: same tiers for liquor as restaurants, or different limits? Recommended: same tiers for v1, revisit after 3 months of data. | Phase 1 | Open | Chris to confirm |
| Q7 | Data separation comfort: is `industry_type`-filtered export enough for legal/finance? Recommended: filtered export is sufficient. | None, but good to confirm | Open | Chris / Vikram to confirm |
| Q8 | Fixed enum vs open string for `industry_type`: text + CHECK constraint. | Phase 1 | **RESOLVED** | Text + CHECK constraint (this PRD assumes it). Locked. |
| Q9 | Domain architecture for liquor vertical? | Phase 5 | **RESOLVED** | **App dashboard:** `liquor.getvatic.com`. **Marketing landing page:** `goneat.ai`. Restaurant follows the same pattern: app on `restaurant.getvatic.com`, marketing on `getticket.ai`. Parent brand at `www.getvatic.com`. |
| Q10 | Landing page split: Option A (one file, parameterized) or Option B (two files)? Recommended: A for v1. | Phase 7 | Open | Bryan to confirm |
| Q11 | Copy authorship: Bryan drafting liquor landing + onboarding copy, or is Chris handling? | Phase 2, 4, 7 | Open | Team to confirm |
| Q12 | Real test liquor store for dev: do we have a Hunter-validated store + 5 competitors to use during Phase 11 QA? | Phase 11 | Partially resolved | Test store is ready (Q1). Need 5 competitors identified for QA. |

**New question surfaced during audit:**

| Q | Question | Blocks Phase | Status | Decision |
|---|---|---|---|---|
| Q13 | `www.getvatic.com` behavior: vertical picker page, or redirect to a default vertical? | Phase 5 | Open | Team to decide. Recommendation: simple redirect to `restaurant.getvatic.com` for v1, vertical picker in v2. |

## 20. Rollout Plan

### Sprint 1 — Launch (Phases 0–7, 10, 11)

**Total duration estimate:** 9.5 working days of focused effort (revised from 11 — Phases 8 and 9 deferred to Sprint 2, but Phase 3 increased by 1 day due to deeper coupling). At Anand's pace of 5 to 7 hours per week that is roughly 4 to 5 calendar weeks. Can be compressed if Henry picks up Phase 7 (landing page) in parallel.

**Phase sequencing (dependencies):**

```
Sprint 1 (launch):
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 10 → Phase 11

Sprint 2 (content signal, post-launch):
Phase 8 → Phase 9 → Phase 11b (content-specific QA)
```

**Parallelizable within Sprint 1:**

- Phase 7 (landing page) can run in parallel with Phase 10 (prompt injection) since they touch different files.

**Ideal parallel plan with Henry:**

- Anand: Phase 0, 1, 2, 3, 4, 5, 6, 10, 11
- Henry: Phase 7 (Sprint 1), then Phase 8, 9 (Sprint 2)
- Bryan: Liquor brand copy, landing page design review, onboarding copy review

**Week-by-week (Sprint 1 estimate):**

- Week 1: Phases 0-2 (audit, schema, config scaffold)
- Week 2-3: Phase 3 (type system generalization — 2.5 days, the most complex phase)
- Week 3: Phase 4 (onboarding generalization)
- Week 4: Phases 5-6 (proxy, admin, email)
- Week 5: Phase 7 + Phase 10 (landing page + prompts, in parallel)
- Week 6: Phase 11 (QA, merge, soft launch)

### Sprint 2 — Content Signal (Phases 8–9)

**Duration estimate:** 3.5 working days, ~2 calendar weeks at current pace.

- Week 7: Phase 8 (liquor content extraction pipeline)
- Week 8: Phase 9 (liquor insight rules) + Phase 11b (content-specific QA)

### Milestones

**Soft launch (end of Sprint 1):** `liquor.getvatic.com` live, `goneat.ai` landing page live, waitlist accepting signups, first real liquor store onboarded for internal testing. All shared signals working (competitor, SEO, events, social, photos, traffic, weather). Content signal disabled for liquor. Restaurant vertical on `restaurant.getvatic.com` and `getticket.ai` fully unaffected.

**Content launch (end of Sprint 2):** Liquor content extraction pipeline live, catalog insight rules active, `signals.content = true` for liquor_store.

**Public launch milestone:** Marketing cleared, real operators onboarded, Stripe billing active on liquor vertical.

## 21. Appendix A — VerticalConfig Interface

```typescript
// lib/verticals/types.ts

export interface VerticalConfig {
  // Identity
  industryType: 'restaurant' | 'liquor_store'
  displayName: string // "Vatic Restaurant", "Vatic Liquor"

  // Core labels used across UI
  labels: {
    businessLabel: string // "restaurant", "liquor store"
    businessLabelPlural: string // "restaurants", "liquor stores"
    businessLabelCapitalized: string // "Restaurant", "Liquor Store"
    competitorLabel: string // "restaurant", "liquor store"
    competitorLabelPlural: string // "restaurants", "liquor stores"
    categoryLabel: string // "Cuisine Type", "Store Type"
    ownerLabel: string // "Restaurant Owner", "Store Owner"
    setupCta: string // "Set up my restaurant", "Set up my store"
  }

  // Category / type lists
  businessCategories: string[] // CUISINES or STORE_TYPES
  categoryEmojis: Record<string, string> // category → emoji map

  // Landing page content
  landing: {
    heroHeadline: string
    heroSubheadline: string
    problemStatement: string
    features: Array<{
      title: string
      description: string
      icon: string
    }>
    howItWorks: string[]
    ctaPrimary: string
    ctaSecondary: string
  }

  // Onboarding copy
  onboarding: {
    splash: {
      title: string
      subtitle: string
      ctaLabel: string
    }
    businessInfo: {
      title: string
      namePlaceholder: string
      categoryPlaceholder: string
      categoryLabel: string
    }
    competitors: {
      searchingLabel: string
      foundLabel: string
      emptyLabel: string
      selectLabel: string
    }
    settings: {
      newCompetitorLabel: string
      reviewThresholdLabel: string
      contentChangeLabel: string
    }
    brief: {
      title: string
      subtitle: string
      ctaLabel: string
    }
  }

  // Email copy
  emailCopy: {
    welcome: {
      subject: string
      headline: string
      intro: string
      tipHeader: string
      tipBody: string
    }
  }

  // Google Places API type for competitor discovery
  placesApiType: string // 'restaurant', 'liquor_store', etc.

  // Content / catalog signal config
  contentExtractor: 'restaurant_menu' | 'liquor_catalog' // dispatches to the right module
  contentDiscoveryTerms: string[] // ["menu", "catering"] or ["products", "spirits", "wine"]
  contentFeatures: FeatureDefinition[] // list of features to detect on the website
  contentInsightModule: 'restaurant' | 'liquor_store' // dispatches insight rule set

  // Signal enable/disable toggles
  signals: {
    competitor: boolean
    seo: boolean
    events: boolean
    content: boolean
    photos: boolean
    traffic: boolean
    weather: boolean
    social: boolean
  }

  // Prompt context for LLM calls
  llmContext: {
    businessDescription: string // "a local restaurant operator..."
    competitorDescription: string
    industryVocabulary: string[] // terms to emphasize in prompts
  }
}

export interface FeatureDefinition {
  key: string // "reservations", "curbsidePickup"
  label: string // "Online Reservations", "Curbside Pickup"
  detectionPatterns: string[] // regex-compatible search terms
}
```

## 22. Appendix B — Restaurant and Liquor Configs (Initial)

**Restaurant config (sketch, full version lives in `lib/verticals/restaurant/config.ts`):**

```typescript
export const restaurantConfig: VerticalConfig = {
  industryType: 'restaurant',
  displayName: 'Vatic Restaurant',
  labels: {
    businessLabel: 'restaurant',
    businessLabelPlural: 'restaurants',
    businessLabelCapitalized: 'Restaurant',
    competitorLabel: 'restaurant',
    competitorLabelPlural: 'restaurants',
    categoryLabel: 'Cuisine Type',
    ownerLabel: 'Restaurant Owner',
    setupCta: 'Set up my restaurant',
  },
  businessCategories: ['American', 'Italian', 'Mexican', 'Asian', 'Bar & Grill', 'Pizza', 'Seafood', 'Steakhouse', /* ... */],
  categoryEmojis: {
    'American': '🍔',
    'Italian': '🍝',
    'Mexican': '🌮',
    'Asian': '🥢',
    // ...
  },
  // ... rest reflects current hardcoded copy, moved here verbatim
  contentExtractor: 'restaurant_menu',
  contentDiscoveryTerms: ['menu', 'catering', 'order', 'dine', 'reservations'],
  contentFeatures: [
    { key: 'reservations', label: 'Online Reservations', detectionPatterns: ['reserve', 'book a table', 'opentable'] },
    { key: 'privateDining', label: 'Private Dining', detectionPatterns: ['private dining', 'events', 'group dining'] },
    { key: 'catering', label: 'Catering', detectionPatterns: ['catering', 'party trays', 'corporate catering'] },
    { key: 'doordash', label: 'DoorDash', detectionPatterns: ['doordash'] },
    { key: 'grubhub', label: 'Grubhub', detectionPatterns: ['grubhub'] },
    { key: 'ubereats', label: 'Uber Eats', detectionPatterns: ['uber eats', 'ubereats'] },
  ],
  contentInsightModule: 'restaurant',
  placesApiType: 'restaurant', // Google Places API type for competitor discovery
  signals: {
    competitor: true,
    seo: true,
    events: true,
    content: true,
    photos: true,
    traffic: true,
    weather: true,
    social: true,
  },
  llmContext: {
    businessDescription: 'a local restaurant operator competing with other nearby restaurants',
    competitorDescription: 'nearby restaurants serving similar cuisine and clientele',
    industryVocabulary: ['menu', 'cuisine', 'chef', 'dine-in', 'takeout', 'catering', 'happy hour'],
  },
}
```

**Liquor store config (sketch, full version lives in `lib/verticals/liquor-store/config.ts`):**

> Note: `signals.content` is `false` for Sprint 1 launch. Set to `true` when Phase 8 ships in Sprint 2.

```typescript
export const liquorStoreConfig: VerticalConfig = {
  industryType: 'liquor_store',
  displayName: 'Vatic Liquor',
  labels: {
    businessLabel: 'liquor store',
    businessLabelPlural: 'liquor stores',
    businessLabelCapitalized: 'Liquor Store',
    competitorLabel: 'liquor store',
    competitorLabelPlural: 'liquor stores',
    categoryLabel: 'Store Type',
    ownerLabel: 'Store Owner',
    setupCta: 'Set up my store',
  },
  businessCategories: [
    'Full-line Liquor Store',
    'Wine Shop',
    'Beer & Wine',
    'Craft Spirits Boutique',
    'Warehouse / Club',
    'Grocery + Liquor',
  ],
  categoryEmojis: {
    'Full-line Liquor Store': '🥃',
    'Wine Shop': '🍷',
    'Beer & Wine': '🍺',
    'Craft Spirits Boutique': '🥃',
    'Warehouse / Club': '📦',
    'Grocery + Liquor': '🛒',
  },
  // DRAFT COPY — NEEDS BRYAN REVIEW
  landing: {
    heroHeadline: 'Know what your competitors are pouring.',
    heroSubheadline: 'Vatic Liquor watches nearby stores so you can stock smarter and price sharper.',
    problemStatement: 'Your competitors adjust pricing every week. You find out when a regular walks out.',
    features: [
      { title: 'Price Watch', description: 'See when a competitor drops bourbon prices or runs a case deal.', icon: 'price-tag' },
      { title: 'Catalog Gaps', description: 'Know which spirits your rivals stock that you don\'t.', icon: 'grid' },
      { title: 'Delivery Coverage', description: 'Track who\'s on Drizly, Instacart, and GoPuff.', icon: 'truck' },
      { title: 'Local Events', description: 'Festivals, sports, holidays that drive foot traffic.', icon: 'calendar' },
      { title: 'Social Signals', description: 'What competitors post and which posts land.', icon: 'instagram' },
      { title: 'Weekly Briefing', description: '5 priorities your store should act on this week.', icon: 'briefing' },
    ],
    howItWorks: [
      'Tell us your store and competitors',
      'We monitor them daily',
      'You get a weekly briefing',
    ],
    ctaPrimary: 'Join the waitlist',
    ctaSecondary: 'See how it works',
  },
  onboarding: {
    splash: {
      title: 'Welcome to Vatic Liquor',
      subtitle: 'Competitive intelligence for liquor stores',
      ctaLabel: 'Set up my store',
    },
    businessInfo: {
      title: 'Tell us about your store',
      namePlaceholder: 'Store name',
      categoryPlaceholder: 'Select store type',
      categoryLabel: 'Store Type',
    },
    competitors: {
      searchingLabel: 'Searching for nearby liquor stores...',
      foundLabel: 'We found nearby liquor stores. Pick up to 5 to track.',
      emptyLabel: 'No nearby liquor stores found. Add them manually.',
      selectLabel: 'Select up to 5 competitors',
    },
    settings: {
      newCompetitorLabel: 'Get alerted when new liquor stores open nearby',
      reviewThresholdLabel: 'Notify me when a competitor\'s reviews shift',
      contentChangeLabel: 'Track catalog and pricing changes',
    },
    brief: {
      title: 'Building your first brief',
      subtitle: 'We\'re scanning the competitive landscape now',
      ctaLabel: 'Go to dashboard',
    },
  },
  emailCopy: {
    welcome: {
      subject: 'Welcome to Vatic Liquor — your intelligence is live',
      headline: 'Your store is being watched (in a good way)',
      intro: 'We\'re scanning your competitors daily. Your first weekly briefing will land in 7 days.',
      tipHeader: 'Quick tip',
      tipBody: 'Check the Insights tab for any pricing moves we\'ve already spotted.',
    },
  },
  contentExtractor: 'liquor_catalog',
  contentDiscoveryTerms: ['products', 'spirits', 'wine', 'beer', 'shop', 'catalog', 'browse', 'buy'],
  contentFeatures: [
    { key: 'curbsidePickup', label: 'Curbside Pickup', detectionPatterns: ['curbside', 'curb side', 'pickup at curb'] },
    { key: 'homeDelivery', label: 'Home Delivery', detectionPatterns: ['home delivery', 'same day delivery', 'local delivery'] },
    { key: 'loyaltyProgram', label: 'Loyalty Program', detectionPatterns: ['rewards', 'loyalty', 'members'] },
    { key: 'tastingEvents', label: 'Tasting Events', detectionPatterns: ['tasting', 'tasting events', 'whiskey tasting', 'wine tasting'] },
    { key: 'bulkOrdering', label: 'Bulk / Case Discounts', detectionPatterns: ['case discount', 'bulk', 'case'] },
    { key: 'drizly', label: 'Drizly', detectionPatterns: ['drizly'] },
    { key: 'instacart', label: 'Instacart', detectionPatterns: ['instacart'] },
    { key: 'gopuff', label: 'GoPuff', detectionPatterns: ['gopuff', 'go puff'] },
  ],
  contentInsightModule: 'liquor_store',
  placesApiType: 'liquor_store', // Google Places API type for competitor discovery
  signals: {
    competitor: true,
    seo: true,
    events: true,
    content: false, // Sprint 1: disabled. Sprint 2: set to true when Phase 8 ships.
    photos: true,
    traffic: true,
    weather: true,
    social: true,
  },
  llmContext: {
    businessDescription: 'a local liquor store operator competing with other nearby liquor stores and alcohol retailers',
    competitorDescription: 'nearby liquor stores, wine shops, and beverage retailers serving similar clientele',
    industryVocabulary: ['bourbon', 'scotch', 'tequila', 'vodka', 'gin', 'rum', 'wine', 'beer', 'spirits', 'ABV', 'proof', 'case', 'fifth', 'handle'],
  },
}
```

---

**End of PRD v2.0**

**Resolved decisions:** Q1 (liquor confirmed, test store ready), Q3 (subdomain detection primary + admin override), Q4 (launch without content signal, Sprint 2), Q8 (text + CHECK constraint), Q9 (domains confirmed: `liquor.getvatic.com` + `goneat.ai` for liquor, `restaurant.getvatic.com` + `getticket.ai` for restaurant).

**Key changes from v1.0 → v2.0:**
- Corrected `middleware.ts` → `proxy.ts` throughout (Next.js 16.1.5 convention)
- Added dual-purpose proxy (vertical detection + Supabase session refresh)
- Updated domain architecture to reflect confirmed five-domain setup
- Increased Phase 3 estimate from 1.5 → 2.5 days (deeper coupling found in audit)
- Deferred Phases 8 and 9 to Sprint 2 (content signal not required for launch)
- Added `placesApiType` to VerticalConfig for Google Places competitor discovery
- Added Sprint 1 / Sprint 2 structure to rollout plan
- Added additional target files discovered during codebase audit (menu-viewer, menu-compare, content page, content pipeline)
- Updated Open Questions table with resolved status and new Q13

**Remaining open questions:** Q2, Q5, Q6, Q7, Q10, Q11, Q12 (partial), Q13. None of these block Phase 0 or Phase 1. Q5/Q6/Q7/Q10/Q11 need Bryan/Chris input before Phase 6+.

Next step: resolve remaining open questions with Bryan and Chris, then kick off Phase 0.