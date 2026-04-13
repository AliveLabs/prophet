# Verticalization PRD — Prophet / Vatic Platform

> **Author:** Anand Iyer
> **Date:** April 7, 2026
> **Status:** Draft — Research & Architecture Phase
> **Purpose:** Audit the existing Prophet codebase end-to-end, document everything restaurant-specific, and evaluate architecture options for supporting multiple business verticals under a single platform.

---

## Table of Contents

1. [Background and Context](#1-background-and-context)
2. [Guiding Principles](#2-guiding-principles)
3. [Full Codebase Audit](#3-full-codebase-audit)
   - 3.1 [Database Schema](#31-database-schema)
   - 3.2 [TypeScript Types and Interfaces](#32-typescript-types-and-interfaces)
   - 3.3 [Intelligence Signals and Providers](#33-intelligence-signals-and-providers)
   - 3.4 [AI / Gemini Prompts](#34-ai--gemini-prompts)
   - 3.5 [Server Actions and API Routes](#35-server-actions-and-api-routes)
   - 3.6 [Insight Rules Engine](#36-insight-rules-engine)
   - 3.7 [Onboarding Flow](#37-onboarding-flow)
   - 3.8 [UI Components and Landing Page](#38-ui-components-and-landing-page)
   - 3.9 [Email Templates](#39-email-templates)
   - 3.10 [Configuration and Constants](#310-configuration-and-constants)
4. [Audit Summary: Impact Matrix](#4-audit-summary-impact-matrix)
5. [Verticalization Options](#5-verticalization-options)
   - Option A: [Fully Separate Codebases](#option-a-fully-separate-codebases)
   - Option B: [Monorepo with Vertical Packages](#option-b-monorepo-with-vertical-packages)
   - Option C: [Single Codebase, Shared Database, Vertical Config Layer](#option-c-single-codebase-shared-database-vertical-config-layer)
   - Option D: [Single Codebase, Separate Databases per Vertical](#option-d-single-codebase-separate-databases-per-vertical)
6. [Recommendation](#6-recommendation)
7. [What Verticalizing for Liquor Stores Specifically Requires](#7-what-verticalizing-for-liquor-stores-specifically-requires)
8. [Open Questions](#8-open-questions)

---

## 1. Background and Context

### What Prophet Does Today

Prophet (branded as **Vatic** externally) is a competitive intelligence platform built for local businesses. It automates competitor discovery, daily monitoring, SEO visibility tracking, local event intelligence, website/menu content analysis, visual intelligence (photos), foot traffic analysis, weather correlation, and actionable insight generation.

As of April 2026, the platform has shipped 10 product phases covering the full intelligence stack: competitor monitoring, SEO, events, content/menu analysis, photo intelligence, foot traffic, weather, social media intelligence, social visual intelligence, and an actionable insight card system with Kanban views.

### The Vertical Expansion Decision

In the April 6, 2026 weekly meeting, the team made two strategic decisions:

1. **Pivot the primary target vertical from restaurants to liquor stores.** A contact named Hunter validated the concept and noted that liquor store owners are constantly analyzing pricing and performance against competitors. Chris confirmed the two-sided revenue model: (a) sell competitive intelligence subscriptions to liquor stores, and (b) at data scale, sell aggregated brand/pricing intelligence back to distributors (Bacardi, etc.). This second revenue stream does not exist in the restaurant sector.

2. **Adopt a single codebase + single shared database architecture** rather than forking separate apps. The consensus: add an `industry_type` column, use branded subdomains per vertical (e.g., `vaticliquor.com`, `vaticrestaurant.com`), and let domain detection at sign-up trigger the correct feature set per industry.

### Action Item

Henry Winget and Anand Iyer are tasked with presenting a thorough options analysis on the brand and codebase verticalization strategy at next week's meeting.

---

## 2. Guiding Principles

Before auditing the codebase, the following constraints shape what a good verticalization architecture looks like:

| Principle | Implication |
|---|---|
| **Speed to market** | Liquor stores are ready now. The architecture must not block a fast first deployment. |
| **Maintainability** | One engineering team. Diverging codebases create exponential maintenance overhead. |
| **Data separation optionality** | If a vertical is sold or spun off, the buyer will expect clean data. Design must not make this impossible. |
| **Performance** | A shared database must not create query performance issues as verticals scale. |
| **Brand differentiation** | Each vertical needs distinct landing pages, copy, and onboarding — even if the underlying engine is identical. |
| **Billing isolation** | Stripe subscriptions, tier limits, and trial periods must work cleanly per organization, not per vertical. |
| **API cost management** | Not all signals are relevant for all verticals. Signal toggles prevent wasteful API spend (e.g., menu extraction for a liquor store). |

---

## 3. Full Codebase Audit

### 3.1 Database Schema

**Overall verdict: The schema is largely industry-agnostic. This is the best news in the audit.**

The database was designed around generic concepts — `organizations`, `locations`, `competitors`, `snapshots`, `insights` — none of which encode the word "restaurant." Critically, menu data is not stored in its own rigid table; it lives as JSON blobs inside `snapshots.raw_data` keyed by `snapshot_type`. This means the schema is more flexible than it might appear.

#### What is Restaurant-Specific in the Schema

| Table | Column / Constraint | Restaurant-Specific? | Notes |
|---|---|---|---|
| `organizations` | All columns | No | Generic: name, tier, trial dates, stripe_customer_id |
| `locations` | All columns | No | name, address, google_place_id, website — all generic |
| `competitors` | All columns | No | name, place_id, status (approved/ignored) — generic |
| `snapshots` | `snapshot_type` enum values | Partially | `'web_menu_weekly'` and `'firecrawl_menu'` values are restaurant-specific labels, but the underlying structure is just a JSON blob |
| `job_types` | enum values | No | 'content', 'visibility', 'events', 'insights', 'photos', 'busy_times', 'weather', 'social', 'refresh_all' — all generic |
| `busy_times` | `typical_time_spent` column | Potentially | Concept of "time spent" is neutral enough; applies to any retail visit |
| `social_profiles` | platform enum | No | Instagram, Facebook, TikTok — generic |
| `location_weather` | All columns | No | Completely generic |
| `tracked_keywords` | All columns | No | SEO keywords — generic |

**What is Missing from the Schema:**

- No `industry_type` column exists anywhere. This is the single most important schema addition needed before verticalization.
- No `vertical_config` table or similar exists for per-vertical signal toggles.

#### What Schema Changes Are Required

1. **Add `industry_type` to `organizations` table.** Values like `'restaurant'`, `'liquor_store'`, `'retail'`, etc. This is the trigger for all vertical-specific logic downstream.
2. **Optionally add `vertical_config` JSONB column** to `organizations` to store per-org signal enable/disable overrides (e.g., a restaurant that doesn't want menu tracking).
3. **Rename `snapshot_type` values** like `'web_menu_weekly'` to `'web_content_weekly'` for industry neutrality (low priority, can be handled with backward-compatible mapping).

**Migration complexity: Low.** These are additive changes — no existing data is at risk.

---

### 3.2 TypeScript Types and Interfaces

**Overall verdict: The type system has the most hardcoding. It will require the most thoughtful refactoring.**

#### Restaurant-Specific Types

**File: `lib/content/types.ts`**

```typescript
// RESTAURANT-SPECIFIC — hardcoded menu taxonomy
export type MenuType = "dine_in" | "catering" | "banquet" | "happy_hour" | "kids" | "other"

// RESTAURANT-SPECIFIC — menu data shape
export type MenuItem = {
  name: string
  description: string | null
  price: string | null
  priceValue: number | null
  tags: string[]  // "vegan", "spicy", "gluten-free" — all restaurant tags
}

export type MenuCategory = {
  name: string
  menuType: MenuType  // restaurant-specific classification
  items: MenuItem[]
}

// RESTAURANT-SPECIFIC — hardcoded restaurant website features
export type DetectedFeatures = {
  reservation: boolean       // restaurants book reservations
  onlineOrdering: boolean    // food ordering
  privateDining: boolean     // private dining rooms
  catering: boolean          // catering services
  happyHour: boolean         // bar/restaurant happy hour
  deliveryPlatforms: string[] // DoorDash, Grubhub, UberEats
}

// RESTAURANT-SPECIFIC — website page classification
export type CorePage = {
  type: "home" | "about" | "reservations" | "catering" | "contact" | "menu" | "other"
}
```

**File: `app/onboarding/steps/restaurant-info.tsx`**

```typescript
// RESTAURANT-SPECIFIC — hardcoded cuisine list
const CUISINES = [
  "American", "Italian", "Mexican", "Asian", "Bar & Grill",
  "Café", "Seafood", "Pizza", "Other",
]
```

#### What Types Are Generic (No Change Needed)

- All `insight` types: status, severity, confidence, category — generic
- All `organization` and `location` types — generic
- All `snapshot` types — generic (JSON blobs)
- All `social` types — generic
- All `SEO` types — generic
- All `billing` types — generic

#### Summary of Type Changes Required

| Type | Change Required |
|---|---|
| `MenuType` | Replace with `ContentCategoryType` — a vertical-configurable string union or enum loaded from vertical config |
| `MenuItem` | Rename to `CatalogItem`; generalize tags (food tags → attribute tags) |
| `MenuCategory` | Rename to `CatalogCategory` |
| `DetectedFeatures` | Make polymorphic — different verticals detect different features |
| `CorePage.type` | Replace hardcoded restaurant pages with a configurable set per vertical |
| `CUISINES` | Replace with vertical-specific `businessCategory` list |

---

### 3.3 Intelligence Signals and Providers

**Overall verdict: Most signals are already vertical-agnostic. Only the content/menu signal is fully restaurant-specific.**

#### Signal-by-Signal Assessment

| Signal | Provider | Restaurant-Specific? | Applies to Liquor Stores? | Notes |
|---|---|---|---|---|
| Competitor Monitoring (reviews, ratings, hours) | Google Places API | No | Yes | Fully generic |
| SEO / Search Visibility | DataForSEO | No | Yes | Fully generic |
| Local Events | DataForSEO Events SERP | No | Yes | Fully generic |
| Foot Traffic / Busy Times | Outscraper | No | Yes | Generic — applies to any walk-in business |
| Weather Intelligence | OpenWeatherMap | No | Yes | Generic — any business affected by weather |
| Social Media (Instagram, Facebook, TikTok) | Data365 | No | Yes | Fully generic |
| Social Visual Intelligence | Gemini Vision | No | Yes | Fully generic — photo analysis is vertical-agnostic |
| Photo Intelligence | Google Places Photos + Gemini Vision | No | Yes | Fully generic |
| Content / Menu Intelligence | Firecrawl + Gemini | **Yes** | **Partially** | The scraping is generic; the menu-specific extraction, classification, and insight rules are restaurant-hardcoded |

#### The Content Signal Is the Only One That Needs Vertical Abstraction

The content pipeline does the following, all of which are restaurant-hardcoded:
- Scrapes the business website looking for a **menu page**
- Extracts **menu items** (name, price, tags like "vegan", "spicy")
- Classifies items into **menu types** (dine_in, catering, banquet, happy_hour, kids)
- Detects **restaurant features** (reservations, online ordering, private dining, delivery platforms)
- Generates **menu-specific insights** (price positioning, category gaps, promo signals)

For liquor stores, the equivalent would be:
- Scraping the website looking for a **products/catalog/spirits page**
- Extracting **product listings** (name, spirit type, brand, price, size/ABV)
- Classifying into **product categories** (bourbon, scotch, tequila, wine, beer, mixers)
- Detecting **store features** (delivery, curbside, loyalty program, event space, tasting events)
- Generating **product-specific insights** (price positioning vs. competitor, product selection gaps, promotional pricing)

**The architecture for content extraction is sound — it just needs parameterization.**

---

### 3.4 AI / Gemini Prompts

**Overall verdict: One critical prompt is deeply restaurant-specific. The rest are already generic or easily parameterized.**

#### Prompt Inventory

**1. Menu Extraction Prompt — `lib/ai/gemini.ts` (CRITICAL)**

This is the most restaurant-hardcoded prompt in the entire codebase:

```
You are a restaurant menu data extraction assistant.
Search Google for the complete current menu of this restaurant,
including all categories and items with prices.

For each category, classify menuType as one of:
- "dine_in" for regular menu categories (appetizers, entrees, desserts, drinks)
- "catering" for catering packages
- "banquet" for banquet/event packages
- "happy_hour" for happy hour specials
- "kids" for children's menus
- "other"
```

Every noun in this prompt is a restaurant noun: "menu", "restaurant", "appetizers", "entrees", "desserts", "drinks", "catering", "banquet", "happy hour", "kids menus."

**For liquor stores, this prompt would need to become:**

```
You are a retail product catalog extraction assistant.
Search Google for the complete current product catalog of this business,
including all categories and individual products with prices.

For each product category, classify categoryType as one of:
- "spirits" for whiskey, bourbon, scotch, rum, tequila, vodka, gin
- "wine" for red wine, white wine, rosé, sparkling, dessert wines
- "beer" for domestic, craft, imported beer and malt beverages
- "mixers" for non-alcoholic mixers, sodas, bitters, garnishes
- "accessories" for glassware, bar tools, gift sets
- "other"
```

**2. Competitor Discovery Prompt — `lib/providers/gemini.ts` (MINOR)**

```
"You are a local business intelligence assistant."
"Only include businesses that compete directly with the target business."
```

Already fully generic — uses "local business" and "target business." No changes needed.

**3. Insight Narrative Prompt — `lib/ai/prompts/insights.ts` (MINOR)**

```
"You are Vatic, a competitive intelligence assistant for local businesses."
```

Already generic — "local businesses" covers all verticals.

**4. Priority Briefing Prompt — `lib/ai/prompts/priority-briefing.ts` (MINOR)**

```
"You are Vatic, an AI competitive intelligence assistant for local businesses.
You provide sharp, data-driven briefings that help business owners make better decisions."
```

Generic. Would benefit from vertical context injection (e.g., "local liquor store"), but not blocking.

**5. Prophet Chat Prompt — `lib/ai/prompts/prophet-chat.ts` (NOT YET ACTIVE)**

The chat feature is not yet implemented. When it is built, the system prompt should accept `industry_type` as a variable to give the LLM appropriate vertical context.

#### Summary of Prompt Changes

| Prompt | File | Change Required | Effort |
|---|---|---|---|
| Menu Extraction | `lib/ai/gemini.ts` | Full rewrite per vertical | Medium |
| Competitor Discovery | `lib/providers/gemini.ts` | None — already generic | None |
| Insight Narratives | `lib/ai/prompts/insights.ts` | Add vertical context variable | Low |
| Priority Briefing | `lib/ai/prompts/priority-briefing.ts` | Add vertical context variable | Low |
| Prophet Chat | `lib/ai/prompts/prophet-chat.ts` | Design with vertical context from start | Low (not yet built) |

---

### 3.5 Server Actions and API Routes

**Overall verdict: Three server actions have meaningful restaurant-specific hardcoding. The rest are generic.**

#### Restaurant-Specific Server Actions

**1. Competitor Discovery Default — `app/(dashboard)/competitors/actions.ts`**

```typescript
const keywordBase = query ?? targetCategory ?? "restaurant"
```

When no query or category is provided, the discovery search falls back to `"restaurant"`. For liquor stores this would need to be `"liquor store"`, derived from `organization.industry_type`.

**2. Onboarding Action — `app/onboarding/actions.ts`**

```typescript
// Parameter naming
restaurantName: string  // should become: businessName

// Organization naming logic
// Currently assumes restaurant context in slug/name generation
```

**3. Content Scraping Action — `app/(dashboard)/content/actions.ts`**

The entire content pipeline action is restaurant-specific:
- Looks for menu URLs on the scraped website
- Passes to Gemini with the restaurant menu extraction prompt
- Classifies scraped content into menu types
- Detects restaurant-specific features (reservations, DoorDash/Grubhub integration, private dining)

This action will need a vertical-configurable extraction strategy injected based on `industry_type`.

**4. Ambient Feed (Quick Tips) — `app/api/jobs/ambient-feed/route.ts`**

```typescript
`Generate 5 brief, specific, actionable tips for a restaurant/business called "${locationName}"`
```

Minor: the prompt says "restaurant/business" — should become `${verticalLabel}/business` or just use the industry type dynamically.

#### Generic Actions (No Changes Needed)

- `app/(dashboard)/competitors/actions.ts` (discovery, approve, ignore) — generic except the fallback above
- All `admin/` actions — fully generic
- All `auth/` actions — fully generic
- All `billing/` actions — fully generic
- All snapshot/insight pipeline actions — generic at the orchestration level

---

### 3.6 Insight Rules Engine

**Overall verdict: 8 content insight rules are fully restaurant-specific. All other insight rules (~40+) are already vertical-agnostic.**

#### Restaurant-Specific Insight Rules — `lib/content/insights.ts`

| Insight Type Key | Description | Restaurant-Specific? |
|---|---|---|
| `menu.price_positioning_shift` | Competitor dropped/raised menu prices | Yes — "menu prices" |
| `menu.category_gap` | Competitor offers a menu category we don't | Yes — "menu category" |
| `menu.signature_item_missing` | Competitor's top item not on your menu | Yes — "menu item" |
| `menu.promo_signal_detected` | Competitor is running a promotion | Yes — promo keywords are restaurant-specific (see below) |
| `menu.menu_change_detected` | Competitor's menu has changed since last snapshot | Yes — "menu" |
| `content.conversion_feature_gap` | Competitor has online reservations/ordering we don't | Yes — detects reservations, private dining, catering |
| `content.delivery_platform_gap` | Competitor is on DoorDash/Grubhub, we aren't | Yes — DoorDash, Grubhub, UberEats |
| `menu.catering_pricing_gap` | Competitor has catering, we don't | Yes — catering |

**Hardcoded Promo Keywords — `lib/content/insights.ts`**

```typescript
const PROMO_KEYWORDS = [
  "happy hour", "weekday special", "kids eat free", "early bird",
  "lunch special", "brunch special", "prix fixe", "tasting menu",
  "all you can eat", "bottomless", "free dessert", "free appetizer",
]
```

Every single one of these is restaurant-specific. For liquor stores, the equivalent would be:

```typescript
const LIQUOR_PROMO_KEYWORDS = [
  "case discount", "buy one get one", "tasting event", "case price",
  "bottle deal", "weekly special", "holiday pricing", "bulk discount",
  "wine tasting", "spirits tasting", "loyalty points", "free delivery",
]
```

**Hardcoded Menu Category Detection Patterns — `lib/content/menu-parse.ts`**

```typescript
const CATERING_PATTERNS = [/\bcater/i, /\bbanquet/i, /\bevent\s*package/i, ...]
const BANQUET_PATTERNS = [/\bbanquet/i, /\bevent\s*package/i, /\bprivate\s*dining\s*menu/i]
const HAPPY_HOUR_PATTERNS = [/\bhappy\s*hour/i, /\bhh\s*special/i, /\bdrink\s*special/i]
const KIDS_PATTERNS = [/\bkid/i, /\bchild/i, /\blittle\s*ones/i, /\bjunior/i]
```

All of these are restaurant/bar menu patterns.

#### Generic Insight Rules (No Changes Needed)

- All competitor rating/review insights — generic
- All SEO insights (~13 types) — generic
- All social media insights (~15 types) — generic
- All social visual insights (~16 types) — generic
- All event insights — generic
- All foot traffic insights — generic
- All weather insights — generic
- All photo insights — generic

**The insight engine's architecture is already a pluggable rules system.** The restaurant-specific rules live in `lib/content/insights.ts` and `lib/content/menu-parse.ts`. These can be swapped out or extended with vertical-specific rule sets without touching the broader insight engine.

---

### 3.7 Onboarding Flow

**Overall verdict: The onboarding wizard is the most user-facing concentration of restaurant-specific language in the app.**

#### Step-by-Step Audit

**Step 0 — Splash Screen (`app/onboarding/steps/splash.tsx`)**
- Copy: `"Set up my restaurant"` — restaurant-specific CTA

**Step 1 — Business Info (`app/onboarding/steps/restaurant-info.tsx`)**

```typescript
// Component prop names (internal, not user-facing, but signals the intent)
restaurantName: string      // should be: businessName
cuisine: string | null      // should be: businessCategory or vertical-specific attribute

// User-facing labels
"Your Restaurant"           // should be: "Your Business"
"Restaurant Name"           // should be: "Business Name"
"Cuisine Type"              // should be: "Business Type" or vertical-specific label

// Hardcoded cuisine list
const CUISINES = ["American", "Italian", "Mexican", "Asian", "Bar & Grill", "Café", "Seafood", "Pizza", "Other"]
// For liquor stores, this would be:
// ["Spirits & Liquor", "Wine & Beer", "Full-Service Bottle Shop", "Bar Supply", "Specialty Imports", "Other"]
```

**Step 2 — Competitor Selection (`app/onboarding/steps/competitor-selection.tsx`)**

```typescript
// User-facing copy
"Searching for nearby restaurants..."
"We found nearby restaurants."
"Search for a specific restaurant…"

// Food category emojis
const CATEGORY_EMOJIS: Record<string, string> = {
  american: "🍔", italian: "🍕", mexican: "🌮", asian: "🥘",
  bar: "🍺", café: "☕", seafood: "🦞", pizza: "🍕",
}
// For liquor stores: 🥃 🍷 🍺 🍸 would be used
```

**Step 3 — Intelligence Settings (`app/onboarding/steps/intelligence-settings.tsx`)**

```typescript
// One hardcoded reference
"Get alerted when new restaurants open in your area"
// Should become: "Get alerted when new [vertical] businesses open in your area"
```

**Step 4 — Loading Brief (`app/onboarding/steps/loading-brief.tsx`)**
- Generic enough — shows animated progress steps, no restaurant-specific hardcoding found.

**Onboarding Wizard State — `app/onboarding/onboarding-wizard.tsx`**

```typescript
// Internal state variable
const [restaurantName, setRestaurantName] = useState("")

// Validation
if (!restaurantName.trim() || !selectedPlace) return

// Submit payload
{ restaurantName: restaurantName.trim(), selectedPlace, cuisine, ... }
```

Changing `restaurantName` to `businessName` and `cuisine` to `businessCategory` across the wizard is a mechanical rename — low complexity.

---

### 3.8 UI Components and Landing Page

**Overall verdict: The marketing landing page has the most concentrated restaurant-specific content. The dashboard itself is largely generic.**

#### Landing Page — `app/page.tsx` and `components/landing/`

**Hero Section (`components/landing/hero-section.tsx`)**

```
"Predictive AI competitive intelligence for the modern restaurant enterprise."
"Competitor X dropped lunch prices 12% — 22 days before POS data reflected the decline."
```

- `"restaurant enterprise"` — hardcoded vertical
- `"lunch prices"` — restaurant pricing context
- `"POS data"` — point-of-sale systems, a restaurant/retail term

**Problem Section (`components/landing/problem-section.tsx`)**

```
"Vatic identified a 14% shift in local menu sentiment 22 days before traditional POS data reflected the decline."
```

- `"menu sentiment"` — restaurant-specific
- `"POS data"` — again, restaurant/retail-specific

**Features Section (`components/landing/features-section.tsx`)**

The animated SVG for "Menu & Content Intelligence" hardcodes restaurant menu category bars with labels:
```
"Entrée", "Appetizer", "Dessert", "Drinks"
```

These are baked into an animated SVG component. For a liquor store landing page, this would need to be:
```
"Spirits", "Wine", "Beer", "Mixers"
```

Other feature copy (SEO, social, competitor monitoring, foot traffic) is already generic.

**Competitor Selection in Onboarding UI** — covered in section 3.7 above.

#### Dashboard UI — `app/(dashboard)/`

The dashboard is largely generic. Key observations:
- The **Insights feed** labels (New, To-Do, Done, Snoozed) are generic
- The **Competitors page** shows business names, ratings, reviews — all generic
- The **SEO page** shows domain metrics — generic
- The **Social page** shows platform metrics — generic
- The **Content page** shows menu items and pricing — this is the only restaurant-specific dashboard page
- The **Events page** shows events near the location — generic
- The **Photos page** shows photo grid analysis — generic
- The **Traffic page** shows busy times heatmap — generic
- The **Home/dashboard page** shows KPIs and freshness indicators — generic

**The dashboard requires almost no changes except the Content/Menu page.**

---

### 3.9 Email Templates

**Overall verdict: One template has a restaurant-specific joke. All others are generic.**

**Welcome Email — `lib/email/templates/welcome.tsx`**

```typescript
<Text style={tip}>
  Tip: Bookmark your dashboard so you can check it between the lunch and dinner rush.
</Text>
```

`"lunch and dinner rush"` is explicitly restaurant-centric. For liquor stores, this might be: `"between restocking and your evening rush."` This is a low-priority copy change.

**All Other Templates — Generic**
- `waitlist-confirmation.tsx` — generic
- `waitlist-invitation.tsx` — generic
- `waitlist-decline.tsx` — generic
- `trial-expiring.tsx` — generic
- `trial-expired.tsx` — generic
- `magic-link.tsx` — generic

---

### 3.10 Configuration and Constants

**Overall verdict: Several configuration files and regex patterns are deeply restaurant-specific and represent the most technically nuanced part of the verticalization work.**

#### Hardcoded Constants That Must Be Verticalized

**Menu Category Patterns — `lib/content/menu-parse.ts`**

```typescript
const CATERING_PATTERNS = [
  /\bcater/i, /\bbanquet/i, /\bevent\s*package/i, /\bgroup\s*dining/i,
  /\bparty\s*pack/i, /\bparty\s*platter/i, /\bbuffet\s*package/i,
  /\blarge\s*party/i, /\bcorporate\s*(lunch|dinner|event)/i,
]
const BANQUET_PATTERNS = [/\bbanquet/i, /\bevent\s*package/i, /\bprivate\s*dining\s*menu/i]
const HAPPY_HOUR_PATTERNS = [/\bhappy\s*hour/i, /\bhh\s*special/i, /\bdrink\s*special/i]
const KIDS_PATTERNS = [/\bkid/i, /\bchild/i, /\blittle\s*ones/i, /\bjunior/i]
```

**Promo Keywords — `lib/content/insights.ts`**

```typescript
const PROMO_KEYWORDS = [
  "happy hour", "weekday special", "kids eat free", "early bird",
  "lunch special", "brunch special", "prix fixe", "tasting menu",
  "all you can eat", "bottomless", "free dessert", "free appetizer",
]
```

**Website Feature Detection (for restaurant features only)**
```typescript
// Detection checks for:
- "reservations" page
- "catering" page  
- "private dining" page
- Delivery platforms: DoorDash, Grubhub, UberEats, Postmates, Caviar
```

**Competitor Discovery Fallback — `app/(dashboard)/competitors/actions.ts`**
```typescript
const keywordBase = query ?? targetCategory ?? "restaurant"
```

**Cuisine List — `app/onboarding/steps/restaurant-info.tsx`**
```typescript
const CUISINES = ["American", "Italian", "Mexican", "Asian", "Bar & Grill", "Café", "Seafood", "Pizza", "Other"]
```

---

## 4. Audit Summary: Impact Matrix

| Category | Component | Vertical-Specific? | Effort to Generalize | Blocks Liquor Store Launch? |
|---|---|---|---|---|
| **Database** | Core schema (orgs, locations, competitors, snapshots) | No | None | No |
| | `snapshot_type` enum label `'web_menu_weekly'` | Minor | Low — rename or alias | No |
| | Missing `industry_type` column | **Critical gap** | Low — one migration | **Yes** |
| **Types** | `MenuType` | **High** | Medium — replace with vertical-configurable enum | Yes |
| | `MenuItem` / `MenuCategory` | **High** | Medium — generalize naming | Yes |
| | `DetectedFeatures` | **High** | Medium — polymorphic per vertical | Yes |
| | `CorePage.type` | Medium | Low — add vertical-configurable values | No |
| | Cuisine list | **High** | Low — vertical-configurable list | Yes |
| **Signals** | Competitor monitoring, SEO, events, social, photos, traffic, weather | None | None | No |
| | Content/menu signal | **High** | High — full vertical abstraction | Yes |
| **Prompts** | Menu extraction prompt | **High** | Medium — parameterize per vertical | Yes |
| | Competitor discovery, briefing, narrative | None or minor | Low — inject vertical label | No |
| **Server Actions** | Competitor discovery fallback | Low | Low — derive from `industry_type` | No |
| | Onboarding action field names | Low | Low — rename `restaurantName` → `businessName` | No |
| | Content scraping action | **High** | High — vertical-configurable extraction strategy | Yes |
| **Insight Rules** | 8 content/menu insight rules | **High** | High — rewrite for each vertical | Yes |
| | ~40+ other insight rules | None | None | No |
| | Promo keywords constant | **High** | Low — vertical-configurable array | Yes |
| | Menu category regex patterns | **High** | Medium — vertical-configurable patterns | Yes |
| **Onboarding** | Step labels, field names | **High** | Low — copy changes + config | Yes |
| | Cuisine list | **High** | Low — vertical-configurable | Yes |
| | Competitor selection copy | **High** | Low — copy changes | Yes |
| | Food emojis for categories | Medium | Low — vertical-configurable | No |
| **Landing Page** | Hero, problem section copy | **High** | Low — per-vertical landing page | No (separate page) |
| | Feature section SVG animations | Medium | Medium — parameterize SVG data | No (separate page) |
| **Dashboard UI** | Insights feed, SEO, social, competitors, photos, traffic, events | None | None | No |
| | Content/menu page | **High** | Medium — generalize labels | Yes |
| **Email** | Welcome template tip | Low | Low — copy change | No |
| | All other templates | None | None | No |

---

## 5. Verticalization Options

Four architecturally distinct approaches were considered.

---

### Option A: Fully Separate Codebases

**Description:** Fork the Prophet repository for each vertical. `prophet-restaurant` and `prophet-liquor` are entirely separate Next.js apps with separate Supabase projects, separate Vercel deployments, separate Stripe configurations, and separate admin dashboards.

**How it works:**
- Fork occurs at `main` branch
- Each fork customizes its vertical-specific content freely
- Shared utilities (billing, auth, cron) are copy-pasted across forks
- Updates to shared features must be manually ported to all forks

**Pros:**
- Maximum isolation — each vertical's data is completely separate, trivially separable for a sale or spin-off
- No code complexity — each fork is a clean, simple codebase
- No cross-contamination of vertical-specific bugs
- Teams can move independently
- Easy to onboard a new vertical developer who only needs to understand one codebase

**Cons:**
- **Maintenance debt grows exponentially.** Every bug fix, every billing change, every security patch must be applied N times. With two verticals this is manageable; with five it becomes untenable.
- **No shared intelligence.** Cross-vertical insights (e.g., liquor store adjacent to a restaurant competing for foot traffic on Friday evenings) are impossible.
- **Duplicate API integrations.** Stripe, Supabase, DataForSEO, Gemini — all must be provisioned and maintained separately.
- **Admin overhead.** Each vertical needs its own admin dashboard. No unified view of the whole business.
- **Feature parity is a nightmare.** When a core feature (like the insight Kanban) is updated in one fork, manually porting it to others introduces bugs and divergence.

**Verdict:** Not recommended. Acceptable only if there is intent to immediately sell one vertical independently and no shared engineering is planned.

---

### Option B: Monorepo with Vertical Packages

**Description:** Move the Prophet codebase into a Turborepo or pnpm workspace monorepo. Create shared packages (`@prophet/core`, `@prophet/billing`, `@prophet/email`) and vertical-specific apps (`apps/restaurant`, `apps/liquor-store`) that import from shared packages.

**How it works:**
- `packages/core` — database client, auth, insight engine, provider integrations
- `packages/billing` — Stripe integration, tier system
- `packages/email` — React Email templates
- `apps/restaurant` — Next.js app with restaurant-specific UI, prompts, types, insight rules
- `apps/liquor-store` — Next.js app with liquor store-specific UI, prompts, types, insight rules
- Shared Supabase database or separate databases with shared schema migrations

**Pros:**
- Clean separation of vertical-specific code from shared infrastructure
- Bug fixes and feature updates to `packages/core` automatically apply to all verticals
- Each vertical app is independently deployable to Vercel
- Type safety enforced at the package boundary — vertical apps can't accidentally use another vertical's types
- Scales well architecturally as more verticals are added

**Cons:**
- **Significant upfront engineering investment.** Turborepo/monorepo setup, package extraction, import resolution, Vercel monorepo configuration — this is a 2–3 week infrastructure project before a single vertical-specific feature is built.
- **Increased build complexity.** Turbopack caching, workspace dependency graphs, and shared Tailwind v4 configuration across packages requires expertise.
- **Database strategy is still an open question.** Monorepo doesn't automatically solve whether data lives in one database or many.
- **Overkill for the current team size.** The benefit of a monorepo accrues at scale. At 1–2 engineers, the overhead may not be worth it until there are 3+ verticals.

**Verdict:** The architecturally cleanest long-term solution, but premature for the current moment. Revisit when a third vertical is being added.

---

### Option C: Single Codebase, Shared Database, Vertical Config Layer

**Description:** Keep the current Next.js application exactly as-is. Add an `industry_type` column to `organizations`. Create a `VerticalConfig` module in `lib/verticals/` that exports per-vertical configuration objects (types, prompts, insight rules, UI copy, signal toggles). All vertical-specific logic is resolved at runtime by reading `organization.industry_type` and loading the appropriate config. Branded subdomains (`vaticliquor.com`, `vaticrestaurant.com`) use the same Next.js deployment, with the vertical resolved from the request hostname.

**How it works:**

```typescript
// lib/verticals/types.ts
export interface VerticalConfig {
  id: string                          // "restaurant" | "liquor_store" | ...
  displayName: string                 // "Restaurant" | "Liquor Store"
  businessLabel: string               // "Restaurant" | "Store"
  competitorSearchTerm: string        // "restaurant" | "liquor store"
  businessCategories: string[]        // cuisines or store types
  categoryEmojis: Record<string, string>
  contentExtractionPrompt: string     // vertical-specific Gemini prompt
  promoKeywords: string[]
  categoryPatterns: CategoryPattern[]
  detectedFeatures: FeatureDefinition[]
  contentInsightRules: InsightRule[]
  activeSignals: SignalKey[]          // which signals to run for this vertical
  landingPageVariant: string          // which landing page to render
  welcomeEmailTip: string
}

// lib/verticals/restaurant.ts
export const restaurantConfig: VerticalConfig = {
  id: "restaurant",
  displayName: "Restaurant",
  businessLabel: "Restaurant",
  competitorSearchTerm: "restaurant",
  businessCategories: ["American", "Italian", "Mexican", ...],
  contentExtractionPrompt: RESTAURANT_MENU_PROMPT,
  promoKeywords: ["happy hour", "kids eat free", "prix fixe", ...],
  activeSignals: ["competitors", "seo", "events", "content", "photos", "busy_times", "weather", "social"],
  ...
}

// lib/verticals/liquor-store.ts
export const liquorStoreConfig: VerticalConfig = {
  id: "liquor_store",
  displayName: "Liquor Store",
  businessLabel: "Store",
  competitorSearchTerm: "liquor store",
  businessCategories: ["Spirits & Liquor", "Wine & Beer", "Full-Service Bottle Shop", ...],
  contentExtractionPrompt: LIQUOR_STORE_PRODUCT_PROMPT,
  promoKeywords: ["case discount", "tasting event", "bottle deal", ...],
  activeSignals: ["competitors", "seo", "events", "content", "photos", "busy_times", "weather", "social"],
  // No "catering" insight, no "delivery platform" insight
  ...
}

// Runtime resolution
// lib/verticals/index.ts
export function getVerticalConfig(industryType: string): VerticalConfig {
  const configs: Record<string, VerticalConfig> = {
    restaurant: restaurantConfig,
    liquor_store: liquorStoreConfig,
  }
  return configs[industryType] ?? restaurantConfig
}
```

All downstream consumers (onboarding wizard, content actions, insight engine, prompts) call `getVerticalConfig(org.industry_type)` instead of using hardcoded constants.

For branded subdomains, `next.config.ts` maps hostnames to industry types:
```typescript
// middleware.ts (new file needed)
const HOSTNAME_TO_INDUSTRY: Record<string, string> = {
  "vaticliquor.com": "liquor_store",
  "vaticrestaurant.com": "restaurant",
  "app.vatic.ai": "restaurant",  // default
}
```

**Pros:**
- **Fastest path to a working liquor store product.** No infrastructure changes required — add a column, add a config file, wire it through.
- **No data migration.** All existing restaurant data stays in the same tables, now tagged with `industry_type = 'restaurant'`.
- **Single admin dashboard.** The admin panel sees all organizations across all verticals. No duplication.
- **Single deployment.** One Vercel project, one Supabase project, one set of API keys.
- **Cross-vertical insights become possible.** If a restaurant and a liquor store are near each other and share a location cluster, future features could surface cross-vertical intelligence.
- **Low upfront investment.** The config layer is an additive change — nothing existing breaks.
- **Data is queryable together.** Negotiating cheaper API/storage pricing is easier with a unified dataset.
- **Subdomain routing is clean.** Each branded domain gets its own landing page, but the app behind it is the same.

**Cons:**
- **Data separation is incomplete.** If a vertical is sold, the buyer gets a Supabase export filtered by `industry_type`, not a clean separate database. This is workable but adds complexity to a hypothetical transaction.
- **Schema governance requires discipline.** As verticals diverge, there will be pressure to add vertical-specific columns to shared tables. Without clear conventions, the schema can become messy.
- **Config file can become complex.** As verticals grow, `VerticalConfig` grows. Needs careful interface design to remain navigable.
- **Accidental cross-contamination risk.** If `getVerticalConfig()` call is forgotten somewhere, restaurant logic runs for a liquor store org. Requires a thorough audit and type-safe enforcement.

**Verdict: Recommended for the current phase.** Fastest time to market, lowest engineering overhead, easiest to maintain with the current team size. The data separation concern is manageable — a clean `organization_id`-filtered database export can serve as a clean data room for any future vertical sale.

---

### Option D: Single Codebase, Separate Databases per Vertical

**Description:** Same as Option C (single codebase, `VerticalConfig` layer, subdomain routing), but each vertical gets its own Supabase project. `vaticliquor.com` connects to `vatic-liquor.supabase.co`; `vaticrestaurant.com` connects to `vatic-restaurant.supabase.co`. The codebase reads the database URL from environment variables resolved at request time based on the hostname/vertical.

**How it works:**
- `lib/supabase/server.ts` is updated to accept a `databaseUrl` parameter resolved from the request hostname
- Separate Supabase projects are provisioned for each vertical
- Schema migrations are applied to all databases (since schema is shared)
- Environment variables: `SUPABASE_URL_RESTAURANT`, `SUPABASE_URL_LIQUOR_STORE`, etc.

**Pros:**
- Clean data separation — each vertical's data lives in its own database, trivially separable for a sale
- Better RLS isolation — no accidental cross-vertical data leakage
- Each vertical can be scaled independently at the database level
- Aligns with how a "house of brands" would think about their data rooms

**Cons:**
- **Operational overhead is significant.** Two Supabase projects means two sets of database credentials, two migration pipelines, two storage buckets, two sets of RLS policies, two sets of Edge Functions.
- **Schema migrations must be applied N times.** Every schema change requires coordinated deployment to all databases. This is error-prone.
- **Cross-vertical queries are impossible.** Can't do platform-level analytics across verticals without ETL.
- **Cost multiplier.** Two Supabase Pro plans instead of one.
- **No shared advantage on storage pricing.** Data is split, so volume discounts that come from centralization are lost.
- **More complexity than needed right now.** With only 2 verticals and 1 team, this overhead doesn't pay off yet.

**Verdict:** Not recommended at this stage. Could revisit at 4+ verticals or when a specific vertical has a strategic reason for full isolation (e.g., regulatory requirements, acquisition discussions).

---

## 6. Recommendation

**Adopt Option C: Single Codebase, Shared Database, Vertical Config Layer.**

### Phase 1: Schema Foundation (1 migration, ~1 day)
1. Add `industry_type` column to `organizations` table with a check constraint `('restaurant', 'liquor_store')`
2. Backfill all existing organizations with `industry_type = 'restaurant'`
3. Add `industry_type` index for query performance

### Phase 2: Vertical Config System (`lib/verticals/`, ~2–3 days)
1. Define the `VerticalConfig` TypeScript interface
2. Extract restaurant config from all hardcoded constants into `lib/verticals/restaurant.ts`
3. Write `lib/verticals/liquor-store.ts` with liquor store equivalents
4. Write `lib/verticals/index.ts` with the `getVerticalConfig()` resolver
5. Wire `getVerticalConfig()` into: `onboarding wizard`, `competitor discovery action`, `content scraping action`, `insight rules engine`, `menu extraction prompt`

### Phase 3: Onboarding Generalization (~1 day)
1. Rename `restaurantName` → `businessName` throughout the wizard
2. Rename `cuisine` → `businessCategory`
3. Replace hardcoded cuisine list with `verticalConfig.businessCategories`
4. Replace hardcoded copy ("Your Restaurant", "Restaurant Name") with `verticalConfig.businessLabel`
5. Replace food emojis with `verticalConfig.categoryEmojis`

### Phase 4: Subdomain Routing (~1 day)
1. Create `middleware.ts` mapping hostnames to `industry_type`
2. Pass `industry_type` through request context so layout/pages can load vertical config
3. Configure DNS for `vaticliquor.com` pointing to the same Vercel deployment

### Phase 5: Vertical Landing Pages (~1 week, design-heavy)
1. Create `/liquor` route (or use subdomain root) with liquor-store-specific hero, copy, and feature section
2. Update animated SVG components to accept `categoryLabels` as props (replaces "Entrée", "Appetizer")
3. Existing `/` landing page remains the restaurant landing page

### Phase 6: Content Signal for Liquor Stores (~3–4 days)
1. Write the liquor store product catalog extraction Gemini prompt
2. Write liquor store content insight rules (price positioning, product gaps, promo signals)
3. Write liquor store promo keywords and category detection patterns
4. Test against 3–5 real liquor store websites

### What Stays Untouched
- All database schema beyond `industry_type` column
- All insight rules for SEO, social, photos, traffic, weather, events, competitors
- Admin dashboard
- Billing and Stripe integration
- Email templates (except welcome tip copy — minor)
- Auth and onboarding infrastructure

---

## 7. What Verticalizing for Liquor Stores Specifically Requires

Beyond the general architecture, here is the specific new content that must be created for a liquor store deployment to be substantively useful (not just cosmetically renamed):

### New: Liquor Store Gemini Prompt

Replace the restaurant menu extraction prompt with a product catalog prompt that extracts:
- Spirit type (bourbon, scotch, tequila, vodka, gin, rum, brandy)
- Brand and distillery
- Price per bottle (standard sizes: 750ml, 1L, 1.75L)
- ABV / proof
- Age statement (for whiskeys)
- Country of origin
- Product description
- Promotional pricing (sale price vs. regular price)

### New: Liquor Store Content Category Types

```typescript
type LiquorContentType = "spirits" | "wine" | "beer" | "mixers" | "accessories" | "other"
// Sub-types for spirits: "bourbon" | "scotch" | "tequila" | "vodka" | "gin" | "rum" | "brandy"
```

### New: Liquor Store Detected Features

```typescript
type LiquorDetectedFeatures = {
  curbsidePickup: boolean
  homeDelivery: boolean
  loyaltyProgram: boolean
  tastingEvents: boolean
  privateLabelProducts: boolean
  bulkOrdering: boolean
  giftWrapping: boolean
  onlineOrderingIntegration: boolean  // Drizly, Instacart, etc.
}
```

### New: Liquor Store Insight Rules

These map to the restaurant insight equivalents but with liquor-specific intelligence:

| New Rule | Restaurant Equivalent | Description |
|---|---|---|
| `catalog.price_positioning_shift` | `menu.price_positioning_shift` | Competitor dropped bottle prices below yours |
| `catalog.product_category_gap` | `menu.category_gap` | Competitor stocks a spirit category you don't (e.g., Japanese whisky) |
| `catalog.promo_signal_detected` | `menu.promo_signal_detected` | Competitor is running a case discount or tasting event |
| `catalog.delivery_platform_gap` | `content.delivery_platform_gap` | Competitor on Drizly/Instacart, you aren't |
| `catalog.exclusive_product_detected` | `menu.signature_item_missing` | Competitor stocks a premium exclusive brand you don't carry |
| `catalog.pricing_tier_gap` | (new) | Competitor has a strong ultra-premium selection, yours skews mid-range |

### Signals That Apply Unchanged to Liquor Stores

- **Competitor monitoring** (ratings, reviews, hours) — identical
- **SEO / search visibility** — identical (liquor stores also compete on Google search)
- **Local events** — identical (events near a liquor store drive traffic just as they do for restaurants)
- **Foot traffic / busy times** — identical (Friday evening traffic for liquor stores mirrors bar/restaurant patterns)
- **Weather** — identical (bad weather affects walk-in traffic)
- **Social media** — identical (Instagram, Facebook, TikTok are heavily used by liquor retailers)
- **Photo intelligence** — identical (store ambiance, product display quality)

### New Signals Worth Considering (Liquor Store-Specific)

- **Pricing intelligence from distributor websites** — spirits pricing is regulated but comparison pricing from distributor data is valuable
- **License tracking** — liquor licenses are public record in most states; tracking competitor license changes or new licensees in a radius is a unique signal
- **Compliance/regulatory events** — state liquor board announcements, holiday sales law changes

---

## 8. Open Questions

The following questions are unresolved and should be decided before implementation begins:

1. **Who owns the liquor store vertical?** Is this Anand's full build or does Henry take part of it?

2. **What is the branching strategy?** Should verticalization happen on `feature-anand` or a new `feature-verticalization` branch?

3. **How should the onboarding wizard detect industry type?** Options:
   - Subdomain detection at sign-up time (user comes from `vaticliquor.com`)
   - Admin sets industry type when approving a waitlist application
   - User selects during onboarding ("What type of business are you?")
   - All three in combination (subdomain pre-fills, user confirms, admin overrides)

4. **Do liquor stores get all the same signals at launch?** Menu/content is the most work. Should the liquor store launch with only competitor monitoring + SEO + social + events (fast), then add content intelligence in a follow-up sprint?

5. **How will the waitlist work for a new vertical?** Same waitlist form at `vaticliquor.com`? Separate ClickUp project for tickets?

6. **What's the pricing strategy for liquor stores?** Same tiers as restaurants, or different limits given different data volumes?

7. **Data separation for potential sale:** If a vertical is sold, the plan is to export organizations filtered by `industry_type`. Is legal/finance comfortable with this approach, or do they require full database isolation?

8. **`industry_type` as a fixed enum or open string?** A fixed enum (`'restaurant' | 'liquor_store'`) is safe and type-checked but requires a migration for every new vertical. An open string with a validation table is more flexible. Recommendation: start with enum, migrate to validation table when third vertical begins.

---

*Last updated: April 7, 2026. This is a living document — update as architectural decisions are made.*
