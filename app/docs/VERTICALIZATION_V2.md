# Verticalization PRD v2 — Vatic Platform → Ticket + Neat

> **Author:** Anand Iyer
> **Date:** April 12, 2026
> **Status:** Locked — Implementation Roadmap (Cursor-ready)
> **Supersedes:** VERTICALIZATION_PRD.md (v1, April 7)
> **Purpose:** Lock the architecture, sequence the work, and provide Cursor-ready implementation blocks to migrate the Vatic codebase from a single restaurant product to a multi-vertical platform serving Ticket (restaurants) and Neat (liquor stores), with the platform engine internally branded as Vatic.

---

## Table of Contents

1. [What Changed Since v1](#1-what-changed-since-v1)
2. [Locked Architecture Decisions](#2-locked-architecture-decisions)
3. [Brand and Domain Model](#3-brand-and-domain-model)
4. [Repository and Deployment Topology](#4-repository-and-deployment-topology)
5. [Phased Implementation Roadmap](#5-phased-implementation-roadmap)
6. [Phase 0 — Branch and Safety Net](#phase-0--branch-and-safety-net)
7. [Phase 1 — Schema Foundation](#phase-1--schema-foundation)
8. [Phase 2 — Vertical Config Layer](#phase-2--vertical-config-layer)
9. [Phase 3 — Subdomain Routing and Middleware](#phase-3--subdomain-routing-and-middleware)
10. [Phase 4 — Onboarding Generalization](#phase-4--onboarding-generalization)
11. [Phase 5 — Per-Vertical Dashboard Chrome](#phase-5--per-vertical-dashboard-chrome)
12. [Phase 6 — Email Templates per Vertical](#phase-6--email-templates-per-vertical)
13. [Phase 7 — Stripe Restructuring](#phase-7--stripe-restructuring)
14. [Phase 8 — Marketing Sites Lift-and-Shift](#phase-8--marketing-sites-lift-and-shift)
15. [Phase 9 — Vatic App Root Cleanup](#phase-9--vatic-app-root-cleanup)
16. [Phase 10 — Neat Shell Launch](#phase-10--neat-shell-launch)
17. [Phase 11 — Liquor Content Intelligence (Follow-Up)](#phase-11--liquor-content-intelligence-follow-up)
18. [Phase 12 — OpenRouter Migration (Nice-to-Have)](#phase-12--openrouter-migration-nice-to-have)
19. [What Stays Untouched](#19-what-stays-untouched)
20. [Risk Register and Mitigations](#20-risk-register-and-mitigations)
21. [Open Questions to Confirm with Bryan and Chris](#21-open-questions-to-confirm-with-bryan-and-chris)

---

## 1. What Changed Since v1

The April 7 PRD recommended Option C (single codebase, shared database, vertical config layer) and that recommendation **stands**. v2 does not relitigate the architecture choice. What v2 adds is everything that v1 left as open questions or could not have known about until the April 6 product lead review and Bryan's April 11 Slack clarification:

1. **Brand model is locked.** Vatic is the platform name (internal, investor-facing). Ticket and Neat are the customer-facing vertical brands. Customers say "Ticket powered by Vatic" and "Neat powered by Vatic." There is no `vaticliquor.com` or `vaticrestaurant.com` — those names from v1 are dead.

2. **Domain topology is locked.** Marketing lives on `getticket.ai` and `goneat.ai`. The authenticated app lives on `ticket.thevatic.ai` and `neat.thevatic.ai`. The platform marketing site (`thevatic.ai` root) is a Phase 2 concern and is not in scope for this document.

3. **Repository strategy is locked.** One Git repo, three Vercel projects: the Vatic app deploys to both `*.thevatic.ai` subdomains, and two thin marketing sites deploy to `getticket.ai` and `goneat.ai` from sibling folders inside the same repo.

4. **Stripe model is locked.** Two Stripe Products (Ticket, Neat), three Prices each (Starter, Pro, Agency) — six total price IDs. This is the future-proof choice that lets pricing diverge per vertical and gives Chris and Bryan native MRR-by-vertical reporting in the Stripe dashboard.

5. **Neat scope is locked.** Neat at launch is a Ticket clone with Neat branding and liquor-store-appropriate copy, running 7 of 8 signals (everything except content/menu intelligence) on day one. The liquor catalog extraction prompt and liquor-specific insight rules are a follow-up phase, not a launch blocker.

6. **The dashboard chrome must render per-vertical.** v1 underscoped this. The logged-in app at `ticket.thevatic.ai` should show **Ticket** branding (logo, sidebar header, page titles, meta tags, email "from" name). The same app at `neat.thevatic.ai` shows **Neat** branding. The Vatic name does not appear to logged-in customers — it stays in admin tools, internal docs, and `thevatic.ai` itself.

7. **Forge tokens are already in place.** BLUEPRINT.md confirms `app/globals.css` already has the Forge / Alive Labs design tokens shipped, with legacy `vatic-indigo` class names aliased to Forge values. This means the rebrand cleanup is partially done — what remains is sweeping legacy class names out of components and adding per-vertical accent variations (Ticket warm/ember, Neat cool/something else).

8. **Henry is no longer on this.** Anand owns this entire project end-to-end. The roadmap is sequenced for a single developer working in Cursor.

---

## 2. Locked Architecture Decisions

| Decision | Choice | Why |
|---|---|---|
| Codebase strategy | Single Next.js app, shared Supabase, shared Stripe account | Fastest path to revenue, lowest maintenance burden, matches v1 Option C recommendation |
| Vertical resolution | `organizations.industry_type` column + `lib/verticals/` config layer + middleware-injected request context | Type-safe, runtime-resolvable, per-org override-able |
| Domain model | Marketing on `getticket.ai` / `goneat.ai`, app on `ticket.thevatic.ai` / `neat.thevatic.ai` | Aligns with Bryan's "Vatic = engine, Ticket/Neat = brands" framing; cheaper than fully separate apps |
| Repo strategy | One repo, three Vercel projects (sibling folders for marketing sites) | Single source of truth for shared logic, no monorepo tooling overhead |
| Stripe products | 2 Products × 3 Prices = 6 price IDs | Future-proof per-vertical pricing, native MRR segmentation in Stripe dashboard |
| Auth | Single Supabase project, single auth user pool, `industry_type` set on org at creation | No per-vertical user duplication; one user can theoretically own orgs in both verticals later |
| Branded chrome | Per-vertical at the React layout level, resolved from middleware-injected `industry_type` context | Same components, different copy/logo/colors via `useVertical()` hook |
| LLM provider abstraction | Direct Gemini SDK for now, OpenRouter migration deferred to Phase 12 (nice-to-have) | Verticalization shouldn't be coupled to LLM provider refactor |

---

## 3. Brand and Domain Model

### 3.1 The Three Brand Layers

```
┌─────────────────────────────────────────────────────────────┐
│  VATIC (Platform — Internal & Investor-Facing)              │
│  - Lives at thevatic.ai (Phase 2, not in scope)             │
│  - Powers all verticals                                      │
│  - Name appears in admin tools, internal docs, investor     │
│    decks, "powered by" attribution                          │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                                ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│  TICKET                 │    │  NEAT                   │
│  Vertical: Restaurants  │    │  Vertical: Liquor       │
│  Marketing: getticket.ai│    │  Marketing: goneat.ai   │
│  App: ticket.thevatic.ai│    │  App: neat.thevatic.ai  │
│  industry_type:         │    │  industry_type:         │
│    'restaurant'         │    │    'liquor_store'       │
└─────────────────────────┘    └─────────────────────────┘
```

### 3.2 What Customers See vs What We See Internally

| Surface | What Customer Sees | What Anand/Admin Sees |
|---|---|---|
| Marketing site | "Ticket — competitive intelligence for restaurants" | Same |
| Login page (`ticket.thevatic.ai/login`) | Ticket logo, Ticket copy | Same |
| Dashboard sidebar header | "Ticket" wordmark | Same |
| Email "from" name | "Ticket" | Same |
| Email footer | "Ticket, powered by Vatic" | Same |
| Admin panel (`/admin`) | N/A | Vatic branding, all orgs visible regardless of industry_type |
| Stripe customer portal | "Ticket Subscription" | Same |
| Browser tab title | "Ticket — Dashboard" | Same |
| Investor pitch deck | N/A | "Vatic platform, currently powering Ticket and Neat" |

### 3.3 Why `ticket.thevatic.ai` and Not `app.getticket.ai`

This is Bryan's call and it's the right one. Three reasons:

1. **It exposes the platform brand to power users.** Restaurant operators who become advocates will eventually notice the URL and ask "what's Vatic?" — that's the moment a partnership conversation starts, or they say "wait, you also do liquor stores?" and pull a friend in.
2. **It scales cleanly to verticals 3, 4, 5.** When `dental.thevatic.ai` and `gym.thevatic.ai` launch, the auth, cookie, and middleware infrastructure already works. There's no per-vertical Vercel project to spin up for the app layer.
3. **Cookie sharing works naturally.** Supabase auth cookies set at `.thevatic.ai` work across all subdomains, which means a future "switch vertical" feature for an operator who owns both a restaurant and a liquor store is mechanically trivial.

---

## 4. Repository and Deployment Topology

### 4.1 Repo Structure

```
vatic/                                    # Single Git repo
├── app/                                  # The Vatic Next.js app (deploys to *.thevatic.ai)
├── components/
├── lib/
├── supabase/
├── public/
├── marketing/                            # NEW — sibling marketing sites
│   ├── getticket/                        # Standalone Next.js project
│   │   ├── app/
│   │   ├── components/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   └── vercel.json
│   └── goneat/                           # Standalone Next.js project
│       ├── app/
│       ├── components/
│       ├── public/
│       ├── package.json
│       ├── next.config.ts
│       └── vercel.json
├── package.json                          # Root package.json (Vatic app)
└── README.md
```

The two marketing folders are **fully independent Next.js projects**, each with their own `package.json` and `next.config.ts`. They share the repo for editing convenience but they don't import from the Vatic app's `lib/` or `components/` (because they don't need to — they only need a waitlist form that POSTs to the Vatic app's API).

### 4.2 Vercel Projects

| Vercel Project | Root Directory | Domain(s) | Purpose |
|---|---|---|---|
| `vatic-app` | `/` (repo root) | `ticket.thevatic.ai`, `neat.thevatic.ai` | Authenticated app, serves both verticals |
| `getticket-marketing` | `/marketing/getticket` | `getticket.ai`, `www.getticket.ai` | Ticket waitlist + marketing pages |
| `goneat-marketing` | `/marketing/goneat` | `goneat.ai`, `www.goneat.ai` | Neat waitlist + marketing pages |

Each Vercel project deploys independently from the same repo using the **Root Directory** setting in Vercel project settings. Pushing to `main` triggers all three deployments simultaneously, but only the project whose root directory contains changed files actually rebuilds (Vercel handles this automatically via path-based change detection).

### 4.3 How Marketing Sites Talk to the App

Both marketing sites have a single waitlist form that POSTs to:

```
POST https://ticket.thevatic.ai/api/waitlist   (from getticket.ai)
POST https://neat.thevatic.ai/api/waitlist     (from goneat.ai)
```

The Vatic app's `/api/waitlist` route reads the `Origin` header to derive the `industry_type`, validates it against an allowlist, and inserts the waitlist row with the correct vertical tag. CORS is configured to accept those two specific origins.

This means the marketing sites are **dumb static sites with one form**. They don't need Supabase credentials, don't need any backend logic, and can be edited by anyone (including Bryan in his fork) without any risk of breaking the app.

---

## 5. Phased Implementation Roadmap

The 12 phases below are sequenced **foundation-outward** — schema first, then config layer, then routing, then UI, then external integrations, then cleanup. Each phase is independently shippable and reversible. Phases 0–7 are blocking for Ticket relaunch on `ticket.thevatic.ai`. Phases 8–10 are blocking for Neat shell launch. Phases 11–12 are post-launch.

| Phase | Name | Blocking For | Est. Effort |
|---|---|---|---|
| 0 | Branch and safety net | Everything | 0.5 day |
| 1 | Schema foundation | Everything | 0.5 day |
| 2 | Vertical config layer | UI changes | 2–3 days |
| 3 | Subdomain routing and middleware | Branded chrome | 1 day |
| 4 | Onboarding generalization | Both verticals working | 1.5 days |
| 5 | Per-vertical dashboard chrome | Customer-ready Ticket | 2–3 days |
| 6 | Email templates per vertical | Customer-ready Ticket | 1 day |
| 7 | Stripe restructuring | Customer billing | 1.5 days |
| 8 | Marketing sites lift-and-shift | Public Ticket launch | 2 days |
| 9 | Vatic app root cleanup | Public Ticket launch | 0.5 day |
| 10 | Neat shell launch | Public Neat launch | 1 day |
| 11 | Liquor content intelligence | Neat content parity | 4–5 days |
| 12 | OpenRouter migration | None (nice-to-have) | 2 days |

**Total to Ticket relaunch (Phases 0–9):** ~12–13 working days
**Total to Neat shell launch (Phases 0–10):** ~13–14 working days
**Total to full Neat parity (Phases 0–11):** ~17–19 working days

At your sustainable pace of 5–7 hours per week, that's roughly 6–8 calendar weeks to Ticket relaunch and 9–11 weeks to full Neat parity. If you can do focused weekend pushes on a few key phases (especially Phase 2 and Phase 5, which are the most concentration-heavy), you can compress this meaningfully.

---

## Phase 0 — Branch and Safety Net

**Goal:** Create a clean working branch and establish a rollback plan before touching anything.

**Why this exists:** The Vatic app has live waitlist signups landing daily. A bad migration or middleware bug could break that flow silently. We need a branch we can push to a Vercel preview deployment for testing, and we need to know exactly how to roll back the schema if something goes wrong.

### Cursor instructions

```
Create a new branch off main called `feature/verticalization-v2`.

Push the empty branch to origin so a Vercel preview deployment is
created automatically. Copy the preview URL and confirm the preview
build succeeds with no changes — this is our baseline. Save the
preview URL somewhere accessible; we will test every phase against
it before merging.

Verify in Vercel that the preview deployment:
- Connects to the production Supabase project (it will, because env
  vars are inherited from the project)
- Does NOT receive production traffic
- Has its own URL like vatic-app-git-feature-verticalization-v2-*.vercel.app

DO NOT change any environment variables. DO NOT touch the production
deployment. DO NOT run any database migrations yet.
```

### Verification checklist

- [ ] Branch `feature/verticalization-v2` exists on origin
- [ ] Vercel preview URL builds successfully and serves the current Vatic app unchanged
- [ ] You can log in on the preview URL with a real account (confirms preview shares production Supabase)
- [ ] Production `ticket.thevatic.ai` (or current production URL) is unaffected

---

## Phase 1 — Schema Foundation

**Goal:** Add `industry_type` to the `organizations` table with a backfill, plus the supporting indexes. This is the single most important schema change in the entire roadmap and it's the foundation everything else rests on.

**Why additive-only:** Per your established pattern, this migration only adds — it does not modify or drop. Existing orgs are backfilled to `'restaurant'` because every org currently in production is a restaurant org (Vatic has only ever served restaurants).

### Cursor instructions

```
Create a new Supabase migration file at:
supabase/migrations/<timestamp>_add_industry_type_to_organizations.sql

The migration must:

1. Create a new enum type `industry_type_enum` with values:
   - 'restaurant'
   - 'liquor_store'

2. Add a column `industry_type` to the `organizations` table:
   - Type: industry_type_enum
   - NOT NULL
   - DEFAULT 'restaurant' (so the migration is non-breaking on insert)

3. Backfill all existing rows: UPDATE organizations SET industry_type = 'restaurant' WHERE industry_type IS NULL;
   (This is belt-and-suspenders — the DEFAULT should already handle it.)

4. Create an index on industry_type for query performance:
   CREATE INDEX idx_organizations_industry_type ON organizations(industry_type);

5. Add a CHECK constraint on `waitlist_signups` table to also store
   industry_type. Add a column `industry_type` to `waitlist_signups`:
   - Type: industry_type_enum
   - NOT NULL
   - DEFAULT 'restaurant'
   This is needed because waitlist signups happen BEFORE an organization
   exists, and we need to know which vertical the user signed up for so
   the admin invitation flow creates the org with the right industry_type.

The migration must be ADDITIVE ONLY. It must not:
- Drop any existing columns
- Modify any existing column types
- Delete any rows
- Change any RLS policies (we'll do that in a separate migration if needed)

After writing the migration, run it against the local Supabase shadow
database first to verify it applies cleanly. Do NOT run it against
production yet.
```

### Verification checklist

- [ ] Migration file exists and applies cleanly to local Supabase
- [ ] `organizations.industry_type` column exists, NOT NULL, DEFAULT 'restaurant'
- [ ] `waitlist_signups.industry_type` column exists, NOT NULL, DEFAULT 'restaurant'
- [ ] Index `idx_organizations_industry_type` exists
- [ ] All existing rows in `organizations` have `industry_type = 'restaurant'`
- [ ] Existing app still works locally with the migration applied (run `npm run dev` and log in)

### After local verification, run on production

Apply the migration to production Supabase via Supabase CLI:
```bash
supabase db push
```

Then verify in Supabase Studio that the column exists and all existing rows have been backfilled to `'restaurant'`. If anything looks wrong, the rollback is:
```sql
ALTER TABLE organizations DROP COLUMN industry_type;
ALTER TABLE waitlist_signups DROP COLUMN industry_type;
DROP TYPE industry_type_enum;
DROP INDEX idx_organizations_industry_type;
```

---

## Phase 2 — Vertical Config Layer

**Goal:** Create `lib/verticals/` as the single source of truth for everything that varies between Ticket and Neat. This is the most concentration-heavy phase in the roadmap and it's worth taking your time on the interface design, because every downstream phase reads from this module.

**Why this matters:** v1 of the PRD outlined a `VerticalConfig` interface but didn't fully spec the file layout. v2 locks the file structure so Cursor can scaffold it cleanly without having to make architectural decisions on the fly.

### File structure to create

```
lib/verticals/
├── types.ts              # VerticalConfig TypeScript interface
├── restaurant.ts         # Ticket / restaurant config
├── liquor-store.ts       # Neat / liquor store config
├── index.ts              # getVerticalConfig() resolver + getCurrentVertical() server-side helper
└── prompts/
    ├── restaurant-content.ts   # The current restaurant menu extraction prompt, moved here verbatim
    └── liquor-content.ts       # NEW liquor catalog extraction prompt (Phase 11 fills this in; for now it's a stub)
```

### Cursor instructions

```
Create the directory lib/verticals/ and the following files.

=== FILE 1: lib/verticals/types.ts ===

Define the TypeScript interface VerticalConfig with the following fields.
Use strict types — no `any`. Use `as const` where appropriate.

export type VerticalId = 'restaurant' | 'liquor_store'

export interface VerticalBranding {
  productName: string              // 'Ticket' | 'Neat'
  productTagline: string           // short marketing tagline
  logoSrc: string                  // path to logo SVG in /public
  faviconSrc: string               // path to favicon
  primaryAccentClass: string       // Tailwind class for primary accent (e.g. 'text-ember-500')
  emailFromName: string            // 'Ticket' | 'Neat'
  emailFromAddress: string         // 'hello@getticket.ai' | 'hello@goneat.ai'
  marketingDomain: string          // 'getticket.ai' | 'goneat.ai'
  appHostname: string              // 'ticket.thevatic.ai' | 'neat.thevatic.ai'
}

export interface VerticalCopy {
  businessLabel: string            // 'Restaurant' | 'Store'
  businessLabelPlural: string      // 'Restaurants' | 'Stores'
  businessNameFieldLabel: string   // 'Restaurant Name' | 'Business Name'
  businessCategoryFieldLabel: string  // 'Cuisine Type' | 'Store Type'
  competitorSearchTerm: string     // 'restaurant' | 'liquor store'
  competitorSearchPlaceholder: string  // 'Search for a specific restaurant…' | 'Search for a specific liquor store…'
  newCompetitorAlertCopy: string   // 'Get alerted when new restaurants open in your area' | '...new liquor stores...'
  contentTabLabel: string          // 'Menu' | 'Catalog'
  contentTabSingular: string       // 'Menu Item' | 'Product'
}

export interface VerticalCategories {
  options: string[]                // cuisine list or store type list
  emojis: Record<string, string>   // category emojis
}

export interface VerticalSignals {
  active: SignalKey[]              // which signals are enabled for this vertical
  contentExtractionPrompt: string  // the Gemini prompt for content extraction
  promoKeywords: string[]          // promo detection keywords
  contentInsightRulesEnabled: boolean  // false for Neat at launch (Phase 11 flips it)
}

export type SignalKey =
  | 'competitors'
  | 'seo'
  | 'events'
  | 'content'
  | 'photos'
  | 'busy_times'
  | 'weather'
  | 'social'
  | 'social_visual'

export interface VerticalConfig {
  id: VerticalId
  branding: VerticalBranding
  copy: VerticalCopy
  categories: VerticalCategories
  signals: VerticalSignals
}

=== FILE 2: lib/verticals/restaurant.ts ===

Import VerticalConfig from ./types and export `restaurantConfig` as a
const VerticalConfig.

Populate every field with the EXACT values that exist in the current
codebase today. Audit these locations and copy verbatim:
- Cuisine list from app/onboarding/steps/restaurant-info.tsx
- Category emojis from app/onboarding/steps/competitor-selection.tsx
- Promo keywords from lib/content/insights.ts
- Menu extraction prompt from lib/ai/gemini.ts (move it here)
- Business labels: 'Restaurant', 'Restaurant Name', 'Cuisine Type'
- competitorSearchTerm: 'restaurant'

For branding:
- productName: 'Ticket'
- productTagline: 'Competitive intelligence for restaurant operators'
- logoSrc: '/brands/ticket/logo.svg'  (file does not exist yet — Phase 5 creates it)
- faviconSrc: '/brands/ticket/favicon.ico'
- primaryAccentClass: 'text-ember-500'  (matches the existing Forge palette)
- emailFromName: 'Ticket'
- emailFromAddress: 'hello@getticket.ai'
- marketingDomain: 'getticket.ai'
- appHostname: 'ticket.thevatic.ai'

For signals.active, list all 9 keys: every signal that currently runs
for restaurants. contentInsightRulesEnabled: true.

=== FILE 3: lib/verticals/liquor-store.ts ===

Import VerticalConfig from ./types and export `liquorStoreConfig`.

Populate fields with liquor-store-appropriate values:

categories.options: [
  'Spirits & Liquor',
  'Wine & Beer',
  'Full-Service Bottle Shop',
  'Bar Supply',
  'Specialty Imports',
  'Other',
]

categories.emojis: {
  'Spirits & Liquor': '🥃',
  'Wine & Beer': '🍷',
  'Full-Service Bottle Shop': '🍾',
  'Bar Supply': '🍸',
  'Specialty Imports': '🌍',
  'Other': '🏪',
}

copy:
  businessLabel: 'Store'
  businessLabelPlural: 'Stores'
  businessNameFieldLabel: 'Store Name'
  businessCategoryFieldLabel: 'Store Type'
  competitorSearchTerm: 'liquor store'
  competitorSearchPlaceholder: 'Search for a specific liquor store…'
  newCompetitorAlertCopy: 'Get alerted when new liquor stores open in your area'
  contentTabLabel: 'Catalog'
  contentTabSingular: 'Product'

branding:
  productName: 'Neat'
  productTagline: 'Competitive intelligence for liquor store operators'
  logoSrc: '/brands/neat/logo.svg'
  faviconSrc: '/brands/neat/favicon.ico'
  primaryAccentClass: 'text-amber-500'  // warmer whiskey-toned amber for Neat
  emailFromName: 'Neat'
  emailFromAddress: 'hello@goneat.ai'
  marketingDomain: 'goneat.ai'
  appHostname: 'neat.thevatic.ai'

signals.active: list 8 keys, EXCLUDING 'content' for now (Phase 11 enables it).
signals.contentExtractionPrompt: import LIQUOR_CONTENT_PROMPT_STUB from './prompts/liquor-content' (which is just a placeholder string for now)
signals.promoKeywords: [
  'case discount', 'buy one get one', 'tasting event', 'case price',
  'bottle deal', 'weekly special', 'holiday pricing', 'bulk discount',
  'wine tasting', 'spirits tasting', 'loyalty points', 'free delivery',
]
signals.contentInsightRulesEnabled: false

=== FILE 4: lib/verticals/index.ts ===

Export the resolver function and the server-side helper:

import { restaurantConfig } from './restaurant'
import { liquorStoreConfig } from './liquor-store'
import type { VerticalConfig, VerticalId } from './types'

const VERTICAL_CONFIGS: Record<VerticalId, VerticalConfig> = {
  restaurant: restaurantConfig,
  liquor_store: liquorStoreConfig,
}

export function getVerticalConfig(industryType: VerticalId | string | null | undefined): VerticalConfig {
  if (industryType && industryType in VERTICAL_CONFIGS) {
    return VERTICAL_CONFIGS[industryType as VerticalId]
  }
  // Safe default for unknown/null cases — restaurant is the legacy default
  return restaurantConfig
}

// Server-side helper that reads the current org's industry_type from
// Supabase using the existing org context resolver. Used in server
// components and server actions.
export async function getCurrentVerticalConfig(): Promise<VerticalConfig> {
  // Implementation: use the existing pattern from lib/auth/org-access.ts
  // to fetch the current org and read its industry_type, then pass to
  // getVerticalConfig(). If no org context exists (e.g. during onboarding
  // before org creation), fall back to reading the request hostname from
  // the headers and resolving via the hostname-to-vertical map (defined in Phase 3).
  // Cursor: implement this carefully — it's the most-called function in the new system.
}

export type { VerticalConfig, VerticalId } from './types'
export { restaurantConfig, liquorStoreConfig }

=== FILE 5: lib/verticals/prompts/restaurant-content.ts ===

Move the restaurant menu extraction prompt verbatim out of lib/ai/gemini.ts
and export it as RESTAURANT_CONTENT_PROMPT. Update lib/ai/gemini.ts to
import from this new location instead of having the prompt inline.

=== FILE 6: lib/verticals/prompts/liquor-content.ts ===

For now, export a stub:

export const LIQUOR_CONTENT_PROMPT_STUB = `[Phase 11: Replace with full liquor catalog extraction prompt]`

This file gets fully built out in Phase 11.

=== IMPORTANT RULES FOR THIS PHASE ===

- DO NOT touch any consumer of these configs yet. We're only creating
  the lib/verticals/ module in isolation. Phases 4–6 will wire it
  through the rest of the codebase.
- DO NOT delete the hardcoded constants in restaurant-info.tsx,
  competitor-selection.tsx, or insights.ts yet. Those deletions happen
  in Phase 4.
- DO ensure the new files type-check cleanly. Run `npm run build`
  after creating them and fix any TypeScript errors before moving on.
- DO write a quick smoke test in scripts/test-verticals.ts that imports
  both configs and prints them to console, just to confirm the module
  loads.
```

### Verification checklist

- [ ] All 6 files exist under `lib/verticals/`
- [ ] `npm run build` passes with no TypeScript errors
- [ ] `npx tsx scripts/test-verticals.ts` prints both configs to console
- [ ] Restaurant config values match what's currently in the codebase exactly
- [ ] Existing app still runs locally with no behavior changes (this phase is purely additive)

---

## Phase 3 — Subdomain Routing and Middleware

**Goal:** Create `middleware.ts` that reads the request hostname, resolves it to an `industry_type`, and injects that into request context so downstream server components can read it without re-fetching.

**Why this is independent of Phase 2:** Phase 2 created the config layer but nothing reads from it yet. Phase 3 creates the routing layer that *will* read from it. They're decoupled because we want to be able to test middleware behavior in isolation.

### Cursor instructions

```
Create app/middleware.ts (or update if it already exists):

import { NextRequest, NextResponse } from 'next/server'

const HOSTNAME_TO_INDUSTRY: Record<string, 'restaurant' | 'liquor_store'> = {
  'ticket.thevatic.ai': 'restaurant',
  'neat.thevatic.ai': 'liquor_store',
  // Local dev fallbacks
  'localhost:3000': 'restaurant',  // default to restaurant locally
  'ticket.localhost:3000': 'restaurant',
  'neat.localhost:3000': 'liquor_store',
}

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? 'localhost:3000'
  const industryType = HOSTNAME_TO_INDUSTRY[hostname] ?? 'restaurant'

  const response = NextResponse.next()

  // Inject industry_type as a request header that server components
  // and server actions can read via headers().
  response.headers.set('x-vatic-industry-type', industryType)
  response.headers.set('x-vatic-hostname', hostname)

  return response
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|brands/|api/cron).*)',
  ],
}

Then create lib/verticals/request-context.ts that reads the header
from the incoming request:

import { headers } from 'next/headers'
import type { VerticalId } from './types'

export async function getVerticalFromRequest(): Promise<VerticalId> {
  const headersList = await headers()
  const industryType = headersList.get('x-vatic-industry-type')
  if (industryType === 'restaurant' || industryType === 'liquor_store') {
    return industryType
  }
  return 'restaurant'  // safe default
}

This function is what getCurrentVerticalConfig() in lib/verticals/index.ts
falls back to when there is no org context (e.g. unauthenticated pages,
login, signup, public marketing pages). Update getCurrentVerticalConfig()
to use this helper.

ROUTING PRECEDENCE for resolving the current vertical:
1. If user is authenticated AND has a current org → use org.industry_type
2. Else → use the request hostname via getVerticalFromRequest()
3. Else → fall back to 'restaurant'

This precedence matters because a Ticket user could theoretically be
served from neat.thevatic.ai if they typo'd the URL, and we'd want their
org's actual industry_type to win over the hostname.

DO NOT yet add either subdomain to Vercel — that happens in Phase 8 when
DNS is being configured. For local testing, edit /etc/hosts to add:
127.0.0.1 ticket.localhost
127.0.0.1 neat.localhost

Then test with `npm run dev` and visit:
- http://ticket.localhost:3000 (should resolve to restaurant)
- http://neat.localhost:3000 (should resolve to liquor_store)

Verify by adding a temporary debug element to the homepage that prints
the current vertical, then remove it before committing.
```

### Verification checklist

- [ ] `middleware.ts` exists and matches all non-static routes
- [ ] `lib/verticals/request-context.ts` exists and exports `getVerticalFromRequest()`
- [ ] `getCurrentVerticalConfig()` in `lib/verticals/index.ts` is wired to use the precedence: org → hostname → default
- [ ] Local test: `ticket.localhost:3000` resolves to restaurant, `neat.localhost:3000` resolves to liquor_store
- [ ] No production behavior change yet (subdomain DNS doesn't exist)

---

## Phase 4 — Onboarding Generalization

**Goal:** Replace every hardcoded restaurant string in the onboarding wizard with a `useVertical()` hook call. After this phase, the onboarding flow renders correctly for both verticals.

### Cursor instructions

```
This phase touches many files. Work through them in this exact order
and verify each one with a local test before moving on.

=== STEP 1: Create the useVertical() hook ===

Create lib/verticals/use-vertical.ts:

'use client'

import { createContext, useContext } from 'react'
import type { VerticalConfig } from './types'

const VerticalContext = createContext<VerticalConfig | null>(null)

export function VerticalProvider({
  config,
  children,
}: {
  config: VerticalConfig
  children: React.ReactNode
}) {
  return (
    <VerticalContext.Provider value={config}>
      {children}
    </VerticalContext.Provider>
  )
}

export function useVertical(): VerticalConfig {
  const config = useContext(VerticalContext)
  if (!config) {
    throw new Error('useVertical must be used within a VerticalProvider')
  }
  return config
}

=== STEP 2: Wire VerticalProvider into the dashboard layout ===

Edit app/(dashboard)/layout.tsx (or wherever the dashboard root layout
lives — confirm via BLUEPRINT.md). At the top of the server component,
call getCurrentVerticalConfig() to resolve the vertical, then wrap the
children in <VerticalProvider config={config}>.

Also wire it into the onboarding layout at app/onboarding/layout.tsx
using the same pattern. For onboarding, the resolution falls back to
hostname (since there's no org yet).

=== STEP 3: Update app/onboarding/onboarding-wizard.tsx ===

Rename internal state:
  restaurantName → businessName
  cuisine → businessCategory

Update the submit payload field names accordingly. The server action
in app/onboarding/actions.ts needs to be updated in step 5 to accept
the new field names.

=== STEP 4: Update app/onboarding/steps/restaurant-info.tsx ===

Rename the file to app/onboarding/steps/business-info.tsx and update
the import in onboarding-wizard.tsx.

In the renamed file:
- Import useVertical from lib/verticals/use-vertical
- const vertical = useVertical()
- Replace 'Your Restaurant' with `Your ${vertical.copy.businessLabel}`
- Replace 'Restaurant Name' with vertical.copy.businessNameFieldLabel
- Replace 'Cuisine Type' with vertical.copy.businessCategoryFieldLabel
- DELETE the hardcoded CUISINES const
- Render category options from vertical.categories.options
- Rename the 'cuisine' prop to 'businessCategory' throughout

=== STEP 5: Update app/onboarding/actions.ts ===

Rename the parameter `restaurantName` to `businessName` everywhere.
Add a new parameter `industryType: 'restaurant' | 'liquor_store'` that
gets persisted to the new organizations.industry_type column when the
org is created.

The industryType value should be derived from the hostname using
getVerticalFromRequest() at the top of the action, NOT passed from the
client (security: a malicious client could otherwise create a Neat org
on Ticket's domain).

=== STEP 6: Update app/onboarding/steps/competitor-selection.tsx ===

- Import useVertical
- Replace 'Searching for nearby restaurants...' with
  `Searching for nearby ${vertical.copy.businessLabelPlural.toLowerCase()}...`
- Replace 'We found nearby restaurants.' similarly
- Replace placeholder with vertical.copy.competitorSearchPlaceholder
- DELETE the hardcoded CATEGORY_EMOJIS const
- Use vertical.categories.emojis instead

=== STEP 7: Update app/onboarding/steps/intelligence-settings.tsx ===

Replace 'Get alerted when new restaurants open in your area' with
vertical.copy.newCompetitorAlertCopy.

=== STEP 8: Update app/onboarding/steps/splash.tsx ===

Replace 'Set up my restaurant' with `Set up my ${vertical.copy.businessLabel.toLowerCase()}`.

=== STEP 9: Update app/(dashboard)/competitors/actions.ts ===

Find the line:
  const keywordBase = query ?? targetCategory ?? "restaurant"

Replace with:
  const vertical = await getCurrentVerticalConfig()
  const keywordBase = query ?? targetCategory ?? vertical.copy.competitorSearchTerm

This ensures Neat orgs default their competitor discovery search to
"liquor store" instead of "restaurant".

=== VERIFICATION FOR THIS PHASE ===

1. Run npm run dev
2. Visit ticket.localhost:3000 — onboarding should look identical to before
3. Visit neat.localhost:3000 — onboarding should show:
   - "Your Store"
   - "Store Name" field
   - "Store Type" dropdown with liquor store categories
   - Liquor store emojis (🥃 🍷)
   - "liquor store" in competitor search
4. Complete onboarding on neat.localhost:3000 with a fake liquor store
5. Verify the new org row in Supabase has industry_type = 'liquor_store'
6. Verify the competitor discovery on the new org searches for "liquor store"

DO NOT proceed to Phase 5 until all 6 verification steps pass.
```

### Verification checklist

- [ ] `useVertical()` hook works in client components within the dashboard layout
- [ ] Onboarding on `neat.localhost:3000` shows liquor-store-specific copy throughout
- [ ] Submitting onboarding on Neat creates an org with `industry_type = 'liquor_store'`
- [ ] Submitting onboarding on Ticket still creates an org with `industry_type = 'restaurant'` (no regression)
- [ ] Competitor discovery on a Neat org defaults to searching "liquor store"

---

## Phase 5 — Per-Vertical Dashboard Chrome

**Goal:** Make the authenticated dashboard render Ticket branding for restaurant orgs and Neat branding for liquor store orgs. This is the work that makes the customer experience feel like a real branded product instead of a generic Vatic dashboard.

### Asset prerequisites

Before starting this phase, you need actual logo files. If they don't exist yet, create simple placeholder SVGs and ask Bryan to replace them when his Figma work is ready.

```
public/brands/ticket/
├── logo.svg            (Ticket wordmark, ~32px tall, monochrome that respects currentColor)
├── logo-icon.svg       (Ticket icon only, 1:1 aspect ratio)
├── favicon.ico
└── og-image.png        (1200x630 social card)

public/brands/neat/
├── logo.svg
├── logo-icon.svg
├── favicon.ico
└── og-image.png
```

### Cursor instructions

```
=== STEP 1: Create the BrandedLogo component ===

Create components/branding/branded-logo.tsx:

'use client'

import Image from 'next/image'
import { useVertical } from '@/lib/verticals/use-vertical'

export function BrandedLogo({
  variant = 'wordmark',
  className,
}: {
  variant?: 'wordmark' | 'icon'
  className?: string
}) {
  const vertical = useVertical()
  const src = variant === 'icon'
    ? vertical.branding.logoSrc.replace('logo.svg', 'logo-icon.svg')
    : vertical.branding.logoSrc

  return (
    <Image
      src={src}
      alt={vertical.branding.productName}
      width={variant === 'icon' ? 32 : 120}
      height={32}
      className={className}
      priority
    />
  )
}

=== STEP 2: Update the dashboard sidebar ===

Find the sidebar component (per BLUEPRINT.md, it's in components/sidebar/
or similar). Replace the current Vatic logo with <BrandedLogo />.

Also update any sidebar header text that says "Vatic" to use
{vertical.branding.productName} instead.

=== STEP 3: Update page metadata per vertical ===

Update app/(dashboard)/layout.tsx to generate metadata dynamically:

import { getCurrentVerticalConfig } from '@/lib/verticals'
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const vertical = await getCurrentVerticalConfig()
  return {
    title: {
      template: `%s — ${vertical.branding.productName}`,
      default: `${vertical.branding.productName} — Dashboard`,
    },
    description: vertical.branding.productTagline,
    icons: {
      icon: vertical.branding.faviconSrc,
    },
  }
}

=== STEP 4: Update app/(auth)/login/page.tsx and signup pages ===

The login and signup pages currently show "Vatic" branding (per
BLUEPRINT.md they were refreshed with editorial luxury branding,
ambient orbs, vatic-gradient CTAs).

These need to:
- Use BrandedLogo instead of hardcoded Vatic SVG
- Show vertical.branding.productTagline as the subtitle
- Update any "Welcome to Vatic" copy to "Welcome to {productName}"
- Keep the editorial luxury treatment (ambient orbs, glass panels) —
  those are visual style, not brand-specific

The auth pages are server components, so use getCurrentVerticalConfig()
at the top instead of useVertical(). Wrap any client child components
that need the vertical in a VerticalProvider.

=== STEP 5: Update the content/menu page label ===

Find app/(dashboard)/content/page.tsx (or wherever the menu page lives).
Update the page title and any "Menu" labels to use
vertical.copy.contentTabLabel instead.

For Neat orgs (where signals.contentInsightRulesEnabled is false), show
a "Catalog Intelligence — Coming Soon" placeholder card instead of the
real menu intelligence UI. Use a simple check:

if (!vertical.signals.contentInsightRulesEnabled) {
  return <ComingSoonCard
    title="Catalog Intelligence"
    description="We're building catalog intelligence for liquor stores. In the meantime, your other 8 signals are live and watching your competitors."
  />
}

=== STEP 6: Filter sidebar nav items by active signals ===

For Neat orgs, the "Content" nav item should still appear (so users
know it's coming) but it should link to the Coming Soon placeholder.
Don't hide it — visible-but-disabled is better UX than missing.

For other signals, if vertical.signals.active does not include a
signal key, that nav item should be hidden entirely. Currently this
won't filter anything for either vertical (Neat just lacks 'content'
processing, but 'content' nav still shows the placeholder), but the
mechanism needs to exist for future verticals.

=== STEP 7: Add per-vertical accent color ===

In app/globals.css, add CSS custom properties scoped by a data attribute:

[data-vertical="restaurant"] {
  --vertical-accent: var(--ember-500);  /* warm ember for Ticket */
  --vertical-accent-hover: var(--ember-600);
}

[data-vertical="liquor_store"] {
  --vertical-accent: theme('colors.amber.500');  /* whiskey amber for Neat */
  --vertical-accent-hover: theme('colors.amber.600');
}

In the dashboard layout, set the data-vertical attribute on the
<body> or <html> tag based on the current vertical.

Then in components, use bg-[var(--vertical-accent)] or
text-[var(--vertical-accent)] for any element that should pick up
the per-vertical accent. Start small — primary CTA buttons, active
sidebar item highlight, focus rings.

DO NOT mass-replace ember references everywhere. The Forge palette
is the underlying default; --vertical-accent is for elements where
the per-vertical pop matters.

=== STEP 8: Final visual sweep ===

Search the codebase for hardcoded "Vatic" string references in
customer-facing surfaces:

grep -ri "Vatic" app/ components/ --include="*.tsx" --include="*.ts"

For each match in a customer-facing component, replace with
{vertical.branding.productName} or vertical.branding.productName.

DO NOT replace Vatic references in:
- /admin/* (admin tools stay Vatic-branded)
- lib/ai/prompts/insights.ts (the LLM system prompt — that's internal)
- code comments
- test files
- README, BLUEPRINT.md, any markdown docs

After this sweep, the only place customers see "Vatic" is the email
footer ("Ticket, powered by Vatic"). That's intentional.
```

### Verification checklist

- [ ] Logging into a restaurant org shows Ticket logo and branding throughout
- [ ] Logging into a liquor store org shows Neat logo and branding throughout
- [ ] Browser tab title says "Ticket — Dashboard" or "Neat — Dashboard"
- [ ] Login page on `ticket.localhost:3000` shows Ticket branding
- [ ] Login page on `neat.localhost:3000` shows Neat branding
- [ ] Neat dashboard's content tab shows the Coming Soon placeholder
- [ ] Per-vertical accent color is visible on at least one CTA on each vertical
- [ ] Admin pages (`/admin/*`) still show Vatic branding (intentional)
- [ ] No regression on Ticket — existing restaurant flow looks identical to before

---

## Phase 6 — Email Templates per Vertical

**Goal:** Make every Resend email render with the correct brand for the recipient's vertical.

### Cursor instructions

```
The current React Email templates live in lib/email/templates/ (per
BLUEPRINT.md). Each template currently has Vatic branding hardcoded.

=== STRATEGY ===

Pass the vertical config into every email template as a prop. This is
cleaner than trying to read context inside React Email components.

=== STEP 1: Update lib/email/client.ts ===

Modify the email-sending functions to accept an `industryType` parameter
(or derive it from the recipient's org). When sending an email, resolve
the VerticalConfig and pass it to the template:

import { getVerticalConfig } from '@/lib/verticals'

export async function sendWaitlistConfirmation({
  email,
  industryType,
}: { email: string; industryType: 'restaurant' | 'liquor_store' }) {
  const vertical = getVerticalConfig(industryType)

  await resend.emails.send({
    from: `${vertical.branding.emailFromName} <${vertical.branding.emailFromAddress}>`,
    to: email,
    subject: `You're on the ${vertical.branding.productName} waitlist`,
    react: WaitlistConfirmation({ vertical }),
  })
}

Apply this pattern to ALL email-sending functions:
- sendWaitlistConfirmation
- sendWaitlistInvitation
- sendWaitlistDecline
- sendWelcome
- sendTrialReminder3Day
- sendTrialReminder1Day
- sendTrialExpired
- sendAdminWaitlistNotification (this one stays Vatic-branded since it goes to admins)

=== STEP 2: Update each React Email template ===

For lib/email/templates/waitlist-confirmation.tsx and every sibling:

import type { VerticalConfig } from '@/lib/verticals/types'

export function WaitlistConfirmation({ vertical }: { vertical: VerticalConfig }) {
  return (
    <Html>
      ...
      <Heading>You're on the {vertical.branding.productName} waitlist</Heading>
      <Text>
        We'll be in touch soon with access to {vertical.branding.productName},
        the competitive intelligence platform for {vertical.copy.businessLabelPlural.toLowerCase()}.
      </Text>
      ...
      <Footer>
        {vertical.branding.productName}, powered by Vatic
      </Footer>
    </Html>
  )
}

Repeat this pattern for every template. The heading, body copy, and
footer should all use vertical.branding.productName.

=== STEP 3: Update lib/email/templates/layout.tsx ===

The shared email layout currently has Vatic branding hardcoded. Make it
accept a `vertical` prop and use vertical.branding throughout.

=== STEP 4: Update callers to pass industryType ===

Find every call site of sendWaitlistConfirmation, sendWaitlistInvitation,
etc., and ensure they pass the right industryType:

- Waitlist signup API route: read industry_type from the waitlist_signups
  row (which was set in Phase 1 from the request hostname)
- Admin invitation flow: read industry_type from the waitlist_signups row
- Trial reminder cron: read industry_type from organizations row
- Welcome email after onboarding: read industry_type from the new org

=== STEP 5: Verify Resend domain configuration ===

The from-addresses hello@getticket.ai and hello@goneat.ai need DNS
records (SPF, DKIM, DMARC) configured in Resend. Document this as a
prerequisite for production launch — you cannot send from these
addresses until DNS is verified.

For local testing, you can keep using the existing verified Vatic
domain temporarily by overriding the from-address with an env var:
RESEND_OVERRIDE_FROM=hello@yourexistingverifieddomain.com

=== STEP 6: Send test emails ===

Write a script at scripts/test-emails.ts that sends one of each
template to your own email address using both verticals. Visually
inspect each email to confirm:
- Correct product name in subject line
- Correct logo (if logos are embedded)
- Correct from-name
- Correct body copy referencing the right business type
- Footer says "[Brand], powered by Vatic"
```

### Verification checklist

- [ ] Every email template accepts a `vertical` prop
- [ ] All callers pass the correct `industryType` based on the org or waitlist row
- [ ] Test script sends both Ticket and Neat versions of every template
- [ ] Visual inspection confirms branding correctness
- [ ] DNS records for `getticket.ai` and `goneat.ai` are documented as a launch prerequisite
- [ ] Admin notification email (to `chris@alivelabs.io`) still shows Vatic branding

---

## Phase 7 — Stripe Restructuring

**Goal:** Migrate from 3 generic price IDs to 6 vertical-specific price IDs (Ticket Starter/Pro/Agency + Neat Starter/Pro/Agency), structured as 2 Stripe Products with 3 Prices each.

### Cursor instructions

```
=== STEP 1: Stripe Dashboard work (manual, not Cursor) ===

In Stripe Dashboard:

1. Rename existing Product "Vatic" to "Ticket"
2. The existing 3 prices under it become Ticket Starter, Ticket Pro,
   Ticket Agency. Update each price's nickname accordingly.
3. Create a new Product "Neat"
4. Create 3 prices under Neat:
   - Neat Starter (decide on price with Bryan/Chris — placeholder $X/mo)
   - Neat Pro
   - Neat Agency
5. Note all 6 price IDs.

For the Neat prices, if Bryan and Chris haven't decided on liquor store
pricing yet, mirror the Ticket prices for now and flag this as an open
question to revisit before Neat goes paid.

=== STEP 2: Update environment variables ===

Rename existing env vars:
  STRIPE_PRICE_ID_STARTER → STRIPE_PRICE_ID_TICKET_STARTER
  STRIPE_PRICE_ID_PRO → STRIPE_PRICE_ID_TICKET_PRO
  STRIPE_PRICE_ID_AGENCY → STRIPE_PRICE_ID_TICKET_AGENCY

Add new env vars:
  STRIPE_PRICE_ID_NEAT_STARTER
  STRIPE_PRICE_ID_NEAT_PRO
  STRIPE_PRICE_ID_NEAT_AGENCY

Update .env.local, .env.example, and Vercel project env vars (preview
and production for the vatic-app project).

=== STEP 3: Refactor lib/billing/tiers.ts ===

The current file probably exports the 3 price IDs as constants. Refactor
to a function that takes industry_type:

import type { VerticalId } from '@/lib/verticals/types'

export type TierName = 'starter' | 'pro' | 'agency'

const PRICE_IDS: Record<VerticalId, Record<TierName, string>> = {
  restaurant: {
    starter: process.env.STRIPE_PRICE_ID_TICKET_STARTER!,
    pro: process.env.STRIPE_PRICE_ID_TICKET_PRO!,
    agency: process.env.STRIPE_PRICE_ID_TICKET_AGENCY!,
  },
  liquor_store: {
    starter: process.env.STRIPE_PRICE_ID_NEAT_STARTER!,
    pro: process.env.STRIPE_PRICE_ID_NEAT_PRO!,
    agency: process.env.STRIPE_PRICE_ID_NEAT_AGENCY!,
  },
}

export function getPriceId(industryType: VerticalId, tier: TierName): string {
  return PRICE_IDS[industryType][tier]
}

// Reverse lookup: given a Stripe price ID, return its vertical and tier.
// Used by Stripe webhook to figure out what was just purchased.
export function resolvePriceId(priceId: string): { industryType: VerticalId; tier: TierName } | null {
  for (const [industryType, tiers] of Object.entries(PRICE_IDS)) {
    for (const [tier, id] of Object.entries(tiers)) {
      if (id === priceId) {
        return { industryType: industryType as VerticalId, tier: tier as TierName }
      }
    }
  }
  return null
}

=== STEP 4: Update Stripe checkout route ===

In app/api/stripe/checkout/route.ts, the current flow probably accepts
a tier name and looks up the price ID. Update it to:

1. Resolve the current org's industry_type
2. Call getPriceId(industryType, tier) to get the right price ID
3. Pass that to Stripe checkout session creation

This means a Ticket org checkout always uses Ticket prices, and a Neat
org checkout always uses Neat prices. There is no scenario where a user
can accidentally subscribe to the wrong vertical's product.

=== STEP 5: Update Stripe webhook ===

The webhook handler in app/api/stripe/webhook/route.ts needs to:

1. On checkout.session.completed, resolve the price ID via
   resolvePriceId() to confirm the vertical matches the org's
   industry_type. Log a warning if there's a mismatch (shouldn't
   happen, but defense in depth).
2. Set the org's subscription_tier based on the resolved tier name.

=== STEP 6: Update tier limit lookups ===

The existing tier system has limits like maxLocations and
maxCompetitorsPerLocation. These limits MIGHT differ per vertical
in the future, but for v2 launch, keep them identical between Ticket
and Neat. Document this as: "Tier limits are currently identical
across verticals; the architecture supports per-vertical limits if
needed in the future."

=== STEP 7: Update billing UI ===

In app/(dashboard)/settings/billing or wherever the upgrade page
lives, show only the prices for the user's vertical. A Neat user
should never see Ticket pricing options.

=== STEP 8: Smoke test ===

1. Create a test Ticket org locally, go to billing, click upgrade,
   verify the Stripe checkout shows Ticket prices.
2. Create a test Neat org locally, go to billing, click upgrade,
   verify the Stripe checkout shows Neat prices.
3. Use Stripe test mode to complete a checkout for each vertical.
4. Verify the org's subscription_tier is set correctly after the
   webhook fires.
```

### Verification checklist

- [ ] 6 price IDs exist in Stripe dashboard, named clearly
- [ ] 6 env vars exist in Vercel and `.env.local`
- [ ] `lib/billing/tiers.ts` uses `getPriceId(industryType, tier)`
- [ ] `resolvePriceId(priceId)` works as a reverse lookup for the webhook
- [ ] Ticket org checkout shows Ticket prices in test mode
- [ ] Neat org checkout shows Neat prices in test mode
- [ ] Webhook correctly sets `subscription_tier` on the org for both verticals

---

## Phase 8 — Marketing Sites Lift-and-Shift

**Goal:** Create the two standalone marketing Next.js projects in `marketing/getticket/` and `marketing/goneat/`, copying the existing landing page over and pointing the waitlist form at the Vatic app.

### Cursor instructions

```
=== STEP 1: Create marketing/getticket/ ===

mkdir -p marketing/getticket
cd marketing/getticket
npm create next-app@latest . -- --typescript --tailwind --app --no-src-dir --no-eslint --turbopack

Then copy the relevant pieces from the Vatic app:

cp -r ../../app/page.tsx ./app/page.tsx
cp -r ../../components/landing ./components/landing
cp -r ../../app/landing.css ./app/landing.css
cp -r ../../public/landing-assets ./public/  (if any)

Update marketing/getticket/app/layout.tsx with Ticket-specific metadata:
- title: 'Ticket — Competitive Intelligence for Restaurant Operators'
- description: appropriate marketing copy
- favicon: Ticket favicon
- og:image: Ticket OG image

Update marketing/getticket/app/page.tsx:
- Remove any imports from @/lib/* (the marketing site does NOT share
  the Vatic app's lib)
- Replace any hardcoded Vatic branding with Ticket branding
- The waitlist form's onSubmit should POST to:
  https://ticket.thevatic.ai/api/waitlist

=== STEP 2: Create the public waitlist API endpoint on the Vatic app ===

In the Vatic app (NOT in the marketing folder), create or update:
app/api/waitlist/route.ts

This endpoint:
1. Accepts POST with { email, name, optional_metadata }
2. Reads the Origin header to determine industry_type:
   - https://getticket.ai → 'restaurant'
   - https://www.getticket.ai → 'restaurant'
   - https://goneat.ai → 'liquor_store'
   - https://www.goneat.ai → 'liquor_store'
3. Returns 403 if Origin is not in the allowlist
4. Inserts a row into waitlist_signups with the resolved industry_type
5. Sends the waitlist confirmation email (Phase 6 wired this to use
   the right vertical based on industry_type)
6. Sends the admin notification to chris@alivelabs.io
7. Returns { success: true }

CORS: respond with Access-Control-Allow-Origin matching the request
origin (only if the origin is in the allowlist), and handle the
preflight OPTIONS request.

=== STEP 3: Create marketing/goneat/ ===

mkdir -p marketing/goneat
cd marketing/goneat
npm create next-app@latest . -- --typescript --tailwind --app --no-src-dir --no-eslint --turbopack

Initially, copy from marketing/getticket/ as the starting point, then
adapt the copy and visuals for liquor stores. The structural layout
(hero, problem statement, features, waitlist) can stay the same — only
the copy, imagery, and brand colors change.

Specific changes for Neat:
- Replace food emojis with liquor store equivalents
- Replace "menu" references with "catalog" or "product"
- Replace restaurant operator personas with liquor store operators
- Update the SVG visualizations:
  - Menu price bars → product price bars (use bottle/spirit names)
  - Replace appetizer/entrée labels with bourbon/wine/scotch
- Update color accent from ember to amber/whiskey tones
- Update copy throughout

The waitlist form posts to https://neat.thevatic.ai/api/waitlist
(same Vatic app, different hostname header — though we could route
both to ticket.thevatic.ai/api/waitlist since the Origin header does
the actual disambiguation. Use whichever is simpler).

=== STEP 4: Vercel configuration ===

In Vercel dashboard, create two new projects:

Project 1: getticket-marketing
- Git repository: same vatic repo
- Root directory: marketing/getticket
- Framework: Next.js
- Production domain: getticket.ai (and www.getticket.ai)

Project 2: goneat-marketing
- Git repository: same vatic repo
- Root directory: marketing/goneat
- Production domain: goneat.ai (and www.goneat.ai)

Both projects should deploy from the same `main` branch. Vercel will
only rebuild a project when files in its root directory change.

DNS:
- Point getticket.ai A/CNAME to Vercel
- Point goneat.ai A/CNAME to Vercel
- Point ticket.thevatic.ai CNAME to the existing Vatic app Vercel project
- Point neat.thevatic.ai CNAME to the same Vatic app Vercel project

=== STEP 5: Smoke test ===

1. Deploy preview branches for all three projects
2. Visit the getticket.ai preview URL — should show Ticket marketing
3. Submit the waitlist form — should hit the Vatic app preview's
   /api/waitlist endpoint and create a waitlist row with
   industry_type = 'restaurant'
4. Same for goneat.ai preview → industry_type = 'liquor_store'
5. Confirm the confirmation emails are sent with the correct branding
   (per Phase 6)
```

### Verification checklist

- [ ] `marketing/getticket/` exists as a standalone Next.js project that builds independently
- [ ] `marketing/goneat/` exists as a standalone Next.js project that builds independently
- [ ] `/api/waitlist` on the Vatic app accepts POSTs from both marketing origins
- [ ] Origin-based industry_type resolution works correctly
- [ ] Vercel has two new projects configured with correct root directories
- [ ] DNS records are documented (apply at launch)
- [ ] Test waitlist signups from both marketing sites land in `waitlist_signups` with correct `industry_type`
- [ ] Confirmation emails arrive with correct vertical branding

---

## Phase 9 — Vatic App Root Cleanup

**Goal:** Now that marketing lives elsewhere, remove the landing page from the Vatic app and replace `/` with a redirect to `/login`.

### Cursor instructions

```
=== STEP 1: Delete the landing page route ===

Delete or replace app/page.tsx in the Vatic app. The new app/page.tsx
should be:

import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/login')
}

=== STEP 2: Delete the landing page components and CSS ===

Delete:
- components/landing/  (entire folder)
- app/landing.css

Verify nothing else in the codebase imports from these locations:
grep -r "components/landing" app/ components/ lib/
grep -r "landing.css" app/ components/

If anything still imports from there, fix the imports first.

=== STEP 3: Delete the public landing assets that are no longer needed ===

Audit public/ for assets that were only used by the landing page.
Move them to marketing/getticket/public/ if they're still needed there
(they should already be copied as part of Phase 8). Then delete from
the Vatic app's public/.

=== STEP 4: Update the public waitlist API to be the only signup path ===

In app/api/waitlist/route.ts (created in Phase 8), this is now the
ONLY path for new waitlist signups. The old form on the Vatic app's
homepage no longer exists. Verify this endpoint is still working as
the marketing sites' POST target.

=== STEP 5: Verify auth flow ===

1. Visit ticket.thevatic.ai (or local equivalent) without a session
2. Should redirect to /login
3. /login should show Ticket branding (Phase 5)
4. Log in successfully → land on /home dashboard

Same flow for neat.thevatic.ai → /login with Neat branding.

=== STEP 6: Update sitemap and robots.txt ===

The Vatic app's robots.txt should now disallow crawling of everything
(it's an authenticated app, no public pages). Add:

User-agent: *
Disallow: /

Marketing sites get their own robots.txt allowing crawling.
```

### Verification checklist

- [ ] `app/page.tsx` redirects to `/login`
- [ ] `components/landing/` is deleted
- [ ] No references to deleted landing files remain in the codebase
- [ ] Visiting `ticket.localhost:3000` without session → redirects to `/login` with Ticket branding
- [ ] Visiting `neat.localhost:3000` without session → redirects to `/login` with Neat branding
- [ ] Marketing sites still work and submit waitlist signups successfully
- [ ] Vatic app robots.txt blocks all crawling

---

## Phase 10 — Neat Shell Launch

**Goal:** Final smoke test of the entire end-to-end Neat flow with real services. After this phase, Neat is ready for waitlist signups and beta access.

### Cursor instructions

```
This is a verification phase, not a code phase. The work is testing,
not building.

=== END-TO-END NEAT TEST ===

1. From an incognito browser, visit goneat.ai (production)
2. Sign up for the waitlist with a real test email
3. Verify confirmation email arrives with Neat branding
4. Verify chris@alivelabs.io receives admin notification
5. Log into /admin on the Vatic app as a platform admin
6. Find the Neat waitlist signup, click Approve
7. Verify the invitation email arrives with Neat branding and a magic link
8. Click the magic link, land on the onboarding wizard
9. Verify the wizard shows Neat copy throughout (Store Name, Store Type,
   liquor store categories, liquor store emojis)
10. Complete onboarding with a real liquor store name and address
11. Verify the dashboard loads with:
    - Neat logo in sidebar
    - Browser tab title "Neat — Dashboard"
    - 8 of 9 nav items active (content shows Coming Soon)
    - Competitor discovery defaulted to "liquor store" search
12. Approve a competitor and verify the daily refresh job runs:
    - Reviews collected ✓
    - SEO data ✓
    - Events ✓
    - Photos ✓
    - Busy times ✓
    - Weather ✓
    - Social ✓
    - Content: skipped (signal disabled)
13. Verify insights generate for the active signals
14. Click "Upgrade" → verify Stripe checkout shows Neat prices
15. Complete a test-mode checkout → verify subscription_tier is set
16. Verify trial expiry emails (when applicable) use Neat branding

=== END-TO-END TICKET REGRESSION TEST ===

Repeat the same flow on getticket.ai → ticket.thevatic.ai. Confirm
nothing has regressed for restaurants. Ticket should look and behave
identically to how Vatic looked before this entire migration, just
with "Vatic" replaced by "Ticket" in customer-facing copy.

=== KNOWN LIMITATIONS TO DOCUMENT ===

For Neat at launch:
- Content/menu intelligence is disabled (Phase 11 enables it)
- Liquor-specific insight rules are not yet written (Phase 11 writes them)
- The catalog extraction prompt is a stub (Phase 11 fills it in)
- Liquor store pricing in Stripe mirrors restaurant pricing (decision
  pending with Bryan/Chris)

These should go into a "Neat Beta — What Works and What's Coming"
internal doc that Bryan can share with early Neat customers.
```

### Verification checklist

- [ ] Full end-to-end Neat signup → onboarding → dashboard flow works in production
- [ ] Full end-to-end Ticket signup flow still works (no regression)
- [ ] All 8 active Neat signals collect data successfully on a real liquor store
- [ ] Neat content tab shows Coming Soon placeholder
- [ ] Neat Stripe checkout works in test mode
- [ ] Internal "Neat Beta scope" doc is written and shared with Bryan

---

## Phase 11 — Liquor Content Intelligence (Follow-Up)

**Goal:** Enable the 9th signal for Neat by writing the liquor catalog extraction prompt and the liquor-specific content insight rules.

**Why this is its own phase:** This is genuine net-new product work, not a refactor. It needs real liquor store websites to test against, and the prompt engineering will require iteration. Doing it after Neat shell launch means you have real beta users whose websites you can use as test data.

### Scope summary (full Cursor instructions deferred to Phase 11 kickoff)

1. Write the liquor catalog extraction Gemini prompt (replace the stub in `lib/verticals/prompts/liquor-content.ts`)
2. Write 6 new liquor content insight rules in `lib/content/insights-liquor.ts`:
   - `catalog.price_positioning_shift`
   - `catalog.product_category_gap`
   - `catalog.promo_signal_detected`
   - `catalog.delivery_platform_gap`
   - `catalog.exclusive_product_detected`
   - `catalog.pricing_tier_gap`
3. Write the liquor type system in `lib/content/types-liquor.ts`:
   - `LiquorContentType`
   - `LiquorDetectedFeatures`
4. Update `lib/content/menu-parse.ts` (or create `catalog-parse.ts`) with liquor category detection regexes
5. Flip `liquorStoreConfig.signals.contentInsightRulesEnabled` to `true`
6. Add `'content'` to `liquorStoreConfig.signals.active`
7. Replace the Coming Soon placeholder with the real catalog UI on the content page
8. Test against 5 real liquor store websites and iterate

**Estimated effort:** 4–5 days of focused work, with another 1–2 days of prompt iteration based on real-world results.

---

## Phase 12 — OpenRouter Migration (Nice-to-Have)

**Goal:** Replace direct Gemini SDK calls with OpenRouter as the unified LLM provider, enabling easy provider switching and multi-model routing.

**Status:** Bryan green-lit this in Slack but explicitly low priority. Do it after Phases 0–11 are shipped and stable.

**Why deferred:** Verticalization touches schema, types, UI, and product surface area. OpenRouter migration touches only the LLM provider abstraction. They don't conflict, but bundling them risks slowing both down. The cleanest sequencing is: ship vertical, then migrate LLM provider.

### Scope summary (deferred)

1. Create `lib/ai/openrouter.ts` as a thin wrapper around the OpenRouter API
2. Add `OPENROUTER_API_KEY` to env
3. Migrate one Gemini call site at a time, starting with the lowest-stakes one (insight narratives)
4. Define a model routing policy: which model handles which task (Claude for narrative, Gemini for vision, GPT for structured extraction, etc.)
5. Add Langfuse instrumentation (already on the marketing plan v3 roadmap) for cost and performance tracking
6. Eventually deprecate direct Gemini SDK once all call sites are migrated

**Estimated effort:** 2 days for the abstraction + 1 day per migrated call site (~5 total call sites).

---

## 19. What Stays Untouched

These are the guardrails. Cursor must NOT modify any of the following without explicit instruction:

| Area | Why It's Off-Limits |
|---|---|
| Database schema beyond the additive `industry_type` migration | The current schema is industry-agnostic and works. Don't refactor what isn't broken. |
| All RLS policies | The org-scoped isolation audit was completed recently. Don't touch it. |
| Insight rules engine architecture | Pluggable rules system already exists. New rules get added, not refactored. |
| All ~40+ existing insight rules for SEO, social, photos, traffic, weather, events, competitors | These are vertical-agnostic and applied to both Ticket and Neat unchanged. |
| Admin dashboard (`/admin/*`) | Stays Vatic-branded, sees all orgs across all verticals. |
| Auth flow (Supabase auth, magic links, OAuth) | Working as-is. |
| Background job pipeline / SSE infrastructure | Refactored recently, stable. |
| Server-side caching (`'use cache'` + `cacheTag`) | Phase 10 work, recent and working. |
| Resend email infrastructure (the SDK integration, the cron jobs) | Phase 6 only changes the *content* of templates, not the sending mechanism. |
| All `lib/providers/*` integrations (DataForSEO, Firecrawl, Outscraper, etc.) | These are vertical-agnostic providers. |
| The Forge / Alive Labs design tokens in `globals.css` | Recently shipped. Phase 5 only adds per-vertical accent CSS variables on top of these. |
| `app/(dashboard)/competitors/*` business logic (discovery, approval, ignore) | Only the fallback search term changes (Phase 4, Step 9). |
| Data365, Gemini Vision, photo intelligence pipeline | Working, vertical-agnostic. |
| `lib/billing/tiers.ts` tier limit values (maxLocations, etc.) | Phase 7 changes the *structure* (lookup by vertical) but not the limit values themselves. |

---

## 20. Risk Register and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration breaks production waitlist signups | Low | High | Phase 0 establishes branch + preview. Phase 1 migration is additive only with default value. Test on preview before merging. |
| Middleware breaks an existing Vatic route | Medium | Medium | Phase 3 is independently testable. Use the matcher config to exclude `/admin`, cron routes, and Next.js internals. |
| Forgotten hardcoded "Vatic" string ships to a customer | High | Low | Phase 5, Step 8 does a grep sweep. Phase 10 end-to-end test catches anything missed. |
| Stripe webhook fires for the wrong vertical's price ID | Low | High | Phase 7 adds `resolvePriceId()` reverse lookup with mismatch logging. Test mode checkouts catch issues before real money. |
| DNS misconfiguration delays launch | Medium | Low | DNS work is documented but not part of the code roadmap. Apply DNS the day before launch and test in a staging window. |
| Marketing site CORS issues block waitlist signups | Medium | High | Phase 8 includes explicit Origin allowlist + preflight handling. Test from real preview URLs before flipping DNS. |
| Per-vertical email templates regress on Ticket | Medium | Medium | Phase 6 test script sends both verticals' templates side-by-side. Visual diff against current production Vatic emails. |
| Existing Ticket users lose dashboard access during cutover | Low | Critical | All migrations are additive. The existing Vatic deployment continues serving until DNS is flipped to the new subdomain. There is no "cutover moment" — the new app is the same app, just at a new URL. |
| Forge / Alive Labs token cleanup is incomplete and visible to customers | Medium | Low | Phase 5 sweep handles customer-facing surfaces. Internal cleanup (admin tools, comments) is non-blocking. |
| Liquor store WTP turns out to be very different from restaurant WTP | Medium | Medium | Phase 7 supports per-vertical pricing natively. Adjusting Neat prices later is a Stripe dashboard change + one env var per price. |
| Bryan's Figma assets aren't ready when Phase 5 needs logos | High | Low | Use placeholder SVGs in Phase 5 with a clear TODO comment. Hot-swap real assets when Bryan delivers them. |

---

## 21. Open Questions to Confirm with Bryan and Chris

These need answers before specific phases go live, but they don't block the start of work:

1. **Logo files for Ticket and Neat.** When will Bryan have Figma exports ready? Phase 5 can use placeholders, but real assets are needed before public launch.
2. **Neat pricing.** Same as Ticket for v1, or different? Phase 7 mirrors Ticket pricing as a placeholder. Decision needed before charging real Neat customers.
3. **DNS cutover window.** When are we actually flipping `getticket.ai` and `goneat.ai` DNS? Should be after Phase 8 verification but before public marketing push.
4. **Resend domain verification.** Who runs the SPF/DKIM/DMARC setup for `getticket.ai` and `goneat.ai`? Either Anand sets this up, or we add it to a Cursor instruction once DNS is in place.
5. **From-address final.** Is `hello@getticket.ai` the right send-from, or do we want `chris@get-ticket.co` to match the cold outbound domain Chris is warming up? The marketing plan suggests the cold outbound domains are separate and just for outbound — transactional should use the brand domain. Confirm.
6. **Neat marketing copy.** Bryan owns this. The Phase 8 instructions say "adapt the copy and visuals for liquor stores" but the actual words should come from Bryan's content work in Cursor.
7. **Existing waitlist signups — do they get migrated?** The current `waitlist_signups` table has signups from the old single-product Vatic landing page. After Phase 1, they all default to `industry_type = 'restaurant'`. Is that correct, or do we need to ask each one which vertical they want?
8. **`thevatic.ai` root site.** Out of scope for v2, but eventually `thevatic.ai` itself should serve a platform marketing page. Who owns that work?
9. **Admin can switch a user between verticals?** Probably no — once an org is created with `industry_type`, it stays. But confirm there's no edge case where Bryan would need to manually re-vertical an org.

---

*End of Verticalization PRD v2. This document is the source of truth for the migration. If reality diverges from the plan, update this document — don't let the plan and the code drift.*
