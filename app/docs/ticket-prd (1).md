# Prophet / Vatic — Prioritized Ticket Execution PRD

> **Author:** Generated for Anand Iyer  
> **Date:** April 15, 2026  
> **Purpose:** Cursor-ready execution plan for all assigned Notion tickets. Prioritized by risk, dependency, and efficiency. Each ticket includes codebase context, files to modify, risk assessment, and step-by-step implementation instructions.

---

## Executive Summary

**16 confirmed tickets** assigned to Anand across the Vatic project, all status "Not started." This PRD organizes them into **5 execution sprints** based on dependency chains, risk levels, and logical grouping. The ordering ensures that nothing breaks — bugs that affect the onboarding funnel come first, then core dashboard functionality, then landing page fixes, then feature work.

> **Note:** If you have additional tickets beyond these 16 (you mentioned 21-22), please share the missing ticket IDs and I'll integrate them into the sprint plan.

---

## Ticket Inventory (All 16, Sorted by Sprint)

| Sprint | ID | Title | Type | Priority | Risk |
|--------|-----|-------|------|----------|------|
| 1 | ALT-28 | Address autocomplete resolves to wrong location | Bug | Critical | High |
| 1 | ALT-29 | Competitor suggestions show non-restaurant businesses | Bug | Critical | Medium |
| 1 | ALT-31 | Onboarding allows completion with zero competitors | Bug | High | Low |
| 1 | ALT-30 | Competitor keyword search returns no results | Bug | High | Medium |
| 2 | ALT-34 | Insights sub-tabs all show identical content | Bug | High | Medium |
| 2 | ALT-38 | Menu & Website sub-tabs don't switch content | Bug | Medium | Medium |
| 2 | ALT-37 | Weather stat cards show N/A while chart has real data | Bug | Medium | Low |
| 2 | ALT-35 | Generate Insights reports success but produces no insights | Bug | Medium | Low |
| 3 | ALT-21 | Contradictory signal count metrics across homepage | Bug | High | Low |
| 3 | ALT-20 | All four footer links are dead (href='#') | Bug | High | Low |
| 3 | ALT-27 | Footer copyright says 'VATIC INTELLIGENCE' | Bug | Low | Low |
| 3 | ALT-26 | 404 page is unstyled Next.js default | Bug | Low | Low |
| 4 | ALT-57 | Add global processing/enrichment status indicator | Feature | Medium | Medium |
| 4 | ALT-53 | Build out Settings page with actual content | Feature | Medium | Medium |
| 4 | ALT-47 | Add aria-live regions for dynamic data updates | Design | Medium | Low |
| 5 | ALT-45 | Add aria-current to active sidebar nav item | Design | Low | Low |
| 5 | ALT-65 | Auto-fetch data on first visit to empty pages | Feature | Medium | Medium |
| 5 | ALT-39 | Header search field is non-functional | Bug | Medium | Low |
| 5 | ALT-40 | Notification bell icon doesn't respond to clicks | Bug | Low | Low |
| 5 | ALT-63 | Add data export capability to dashboard pages | Feature | Medium | High |
| 5 | ALT-64 | Add team sharing and collaboration on insights | Feature | Low | High |

---

## Risk Assessment Matrix

### Risk Definitions

- **High Risk:** Touches core data pipelines, auth flows, external API integrations, or database schema. Regression could break existing functionality for all users.
- **Medium Risk:** Touches shared UI components or state management used across multiple pages. Regression is localized but visible.
- **Low Risk:** Isolated change to a single file or component. No shared state or cross-page impact.

### Global Risk Mitigations

1. **Always work on `feature-anand` branch** — never commit directly to `dev` or `main`.
2. **Run `npm run build` after every ticket** — catches TypeScript errors and SSR issues before deployment.
3. **Run `npm run lint` after every ticket** — catches style/import issues.
4. **Test in dark mode AND light mode** — the app is dark-mode-primary but light mode is user-facing.
5. **Test with at least one location + one approved competitor** — most dashboard pages require this context.
6. **After touching any component in `components/` that's used across pages, verify ALL pages that import it.**

---

## Sprint 1: Onboarding Funnel (Critical Path)

**Why first:** These 4 bugs block new user onboarding. A user who can't successfully onboard cannot use the product at all. Zero regression risk to existing data — these are all input validation and UI fixes.

---

### Ticket 1.1: ALT-28 — Address autocomplete resolves to wrong location

**Priority:** Critical | **Type:** Bug | **Risk:** High

**What's broken:** When entering "Gloria's Latin Cuisine Addison TX" in the onboarding address autocomplete, the Google Places API resolved to "Dallas Borough, Pennsylvania" instead of the correct Texas location.

**Codebase context:**
- `lib/places/google.ts` — `fetchAutocomplete()` calls Google Places Autocomplete API
- `app/onboarding/steps/restaurant-info.tsx` — renders the autocomplete input
- `components/places/location-search.tsx` — the autocomplete search component

**Root cause hypothesis:** The `fetchAutocomplete()` call likely isn't passing location bias parameters (latitude/longitude or `locationBias`). Without geographic context, Google's autocomplete returns results biased toward the API key's registered region or alphabetical proximity.

**Implementation steps for Cursor:**

```
1. Open `lib/places/google.ts` — find the `fetchAutocomplete()` function
2. Check if the function accepts and passes `locationBias` or `location` + `radius` parameters to the Google Places Autocomplete (New) API
3. If not, add optional `locationBias?: { lat: number; lng: number; radius?: number }` parameter
4. In the API call body, add: `locationBias: { circle: { center: { latitude, longitude }, radius: radius || 50000 } }`
5. Open `components/places/location-search.tsx` — when calling fetchAutocomplete, pass the user's browser geolocation (if available) or a sensible US-center default
6. In `app/onboarding/steps/restaurant-info.tsx` — pass geolocation context to the search component
7. ALSO: Consider adding `includedPrimaryTypes: ["restaurant", "food", "cafe", "bar", "meal_takeaway", "meal_delivery"]` to the autocomplete request to filter non-business results (this also helps ALT-29)
```

**Testing:**
- Search "Gloria's Latin Cuisine Addison TX" — should resolve to Texas
- Search "pizza" with no location — should use browser geolocation or US default
- Search a business name in a small town — verify correct state

**Risk notes:** This touches the Google Places API call used by both onboarding AND the "Add Location" flow on the dashboard. Test both paths. The `fetchAutocomplete()` function is also used by `components/places/location-add-form.tsx`.

---

### Ticket 1.2: ALT-29 — Competitor suggestions show non-restaurant businesses

**Priority:** Critical | **Type:** Bug | **Risk:** Medium

**What's broken:** Competitor suggestions during onboarding included government offices, post offices, and banks. Related to ALT-28 — when the address resolved to the wrong location, the nearby search pulled irrelevant businesses.

**Codebase context:**
- `lib/providers/gemini.ts` — Gemini competitor discovery provider. Uses Google Maps grounding to find nearby competitors.
- `lib/providers/scoring.ts` — `scoreCompetitor()` relevance scoring
- `app/(dashboard)/competitors/actions.ts` — competitor discovery action, line: `const keywordBase = query ?? targetCategory ?? "restaurant"`
- `app/onboarding/steps/competitor-selection.tsx` — renders competitor candidates

**Implementation steps for Cursor:**

```
1. Open `lib/providers/gemini.ts` — find the competitor discovery prompt
2. Verify the prompt includes type filtering (e.g., "Only include businesses that compete directly with the target business" — per the blueprint, this exists but may not be strict enough)
3. Add explicit type exclusion: "Do NOT include government offices, banks, post offices, gas stations, or other non-food businesses"
4. Open `lib/providers/scoring.ts` — check `scoreCompetitor()` for type filtering
5. Add a type-based filter: if the Google Places `types` array contains ["local_government_office", "bank", "post_office", "gas_station", "atm", "car_repair", "school", "hospital", "church"], score = 0 or filter out entirely
6. Open `app/(dashboard)/competitors/actions.ts` — verify the `keywordBase` fallback uses `organization.industry_type` (from getVerticalConfig) rather than hardcoded "restaurant"
7. If the vertical config system is wired up, use `verticalConfig.competitorSearchTerm` instead of "restaurant"
```

**Testing:**
- Onboard with a real restaurant address — verify only restaurants/food businesses appear
- Test with a liquor store address (if vertical support is active) — verify appropriate businesses

**Risk notes:** This changes the Gemini prompt and scoring, which affects both onboarding discovery AND the manual "Discover Competitors" action on the dashboard. Test both paths.

---

### Ticket 1.3: ALT-31 — Onboarding allows completion with zero competitors

**Priority:** High | **Type:** Bug | **Risk:** Low

**What's broken:** The onboarding wizard lets users proceed past competitor selection without approving any competitors. The product is meaningless without at least one competitor to monitor.

**Codebase context:**
- `app/onboarding/onboarding-wizard.tsx` — manages wizard state and step progression
- `app/onboarding/steps/competitor-selection.tsx` — the competitor selection step

**Implementation steps for Cursor:**

```
1. Open `app/onboarding/onboarding-wizard.tsx`
2. Find the step progression logic (likely a `handleNext()` or `handleContinue()` function)
3. For the competitor selection step, add a validation check:
   - Count the number of competitors with `metadata.status === "approved"`
   - If count === 0, show an inline error message: "Please approve at least one competitor to continue"
   - Disable the "Continue" / "Next" button until at least one competitor is approved
4. Open `app/onboarding/steps/competitor-selection.tsx`
5. Add visual feedback: if no competitors are approved and user tries to advance, highlight the approved section or show a toast
6. Ensure the validation message uses the brand-appropriate tone
```

**Testing:**
- Try to advance past competitor step with 0 approved — should be blocked
- Approve 1 competitor — should be able to advance
- Approve 3, then un-approve all — should block again

**Risk notes:** Very low. This is a client-side validation gate — no server-side changes, no database changes, no API changes.

---

### Ticket 1.4: ALT-30 — Competitor keyword search returns no results

**Priority:** High | **Type:** Bug | **Risk:** Medium

**What's broken:** The competitor keyword search field on the Candidates tab returned no results for any search term. Only pre-populated Google Places nearby suggestions were available.

**Codebase context:**
- `app/onboarding/steps/competitor-selection.tsx` — has a search input for finding competitors
- `components/competitors/discover-form.tsx` — competitor discovery form
- `app/(dashboard)/competitors/actions.ts` — `discoverCompetitors()` server action
- `lib/providers/gemini.ts` — Gemini discovery provider

**Implementation steps for Cursor:**

```
1. Open `app/onboarding/steps/competitor-selection.tsx`
2. Find the search input and its onChange/onSubmit handler
3. Verify it calls a server action or API to search for competitors by keyword
4. Check if the search is wired up to `discoverCompetitors()` or a separate search function
5. If the search handler exists but doesn't trigger, check:
   - Is the form submission prevented? (e.g., missing onSubmit, event.preventDefault without calling the action)
   - Is the search action returning results but the UI not rendering them?
   - Is there a state update issue where results are set but the component doesn't re-render?
6. If the search handler doesn't exist (placeholder input), wire it up:
   - On submit, call the discover competitors action with the search term as the query
   - Display results in the candidates list below
   - Merge with existing nearby suggestions (don't replace them)
7. Check if `components/places/location-search.tsx` has a reusable pattern for autocomplete that can be adapted
```

**Testing:**
- Type "pizza" in the competitor search during onboarding — should return results
- Type a specific restaurant name — should return matching results
- Empty search — should keep showing nearby suggestions

**Risk notes:** If this requires wiring up a new call to `discoverCompetitors()`, be aware that action calls Gemini with Google Maps grounding, which has API costs. Consider debouncing the search input (300ms+).

---

## Sprint 2: Dashboard Data Display Bugs

**Why second:** These bugs affect users who successfully onboarded but see broken or stale data on dashboard pages. Fixing these makes the core product functional.

---

### Ticket 2.1: ALT-34 — Insights sub-tabs all show identical content

**Priority:** High | **Type:** Bug | **Risk:** Medium

**What's broken:** Feed and Briefing sub-tabs show identical content. Clicking Briefing highlights the tab but the content doesn't change. Charts, Social, and Photos tabs also suspected.

**Codebase context:**
- `components/insights/insight-tabs.tsx` — sub-tab navigation component
- `components/insights/insight-feed.tsx` — the Feed view (category-grouped feed + Kanban board)
- `components/insights/priority-briefing.tsx` — the Briefing view
- `components/insights/insights-dashboard.tsx` — the Charts view (Recharts)
- `components/insights/social-dashboard.tsx` — the Social view
- `components/insights/photo-gallery.tsx` — the Photos view
- `app/(dashboard)/insights/page.tsx` — the insights page (server component)

**Implementation steps for Cursor:**

```
1. Open `app/(dashboard)/insights/page.tsx` — understand how the page renders
2. Check if it uses URL-based tab routing (e.g., ?tab=feed, ?tab=briefing) or client-side state
3. Open `components/insights/insight-tabs.tsx` — check if tab clicks:
   a. Update URL params (preferred for SSR), OR
   b. Update local state that's passed to a conditional renderer
4. The issue is likely one of:
   a. Tabs update visual state but don't trigger content switch (onClick only changes active tab styling, doesn't change rendered component)
   b. All tab content is rendered simultaneously and there's no conditional display
   c. URL params are set but the page.tsx doesn't read them to choose which component to render
5. Fix: Ensure the page component or a client wrapper reads the active tab and conditionally renders:
   - "feed" → <InsightFeed />
   - "briefing" → <PriorityBriefing />
   - "charts" → <InsightsDashboard />
   - "social" → <SocialDashboard />
   - "photos" → <PhotoGallery />
6. If using URL params, ensure insight-tabs.tsx updates the URL and the page re-renders
7. If using client state, ensure the state is passed to a parent component that does the conditional rendering
```

**Testing:**
- Click each tab — content should visually change
- Deep-link to `/insights?tab=briefing` — should show Briefing, not Feed
- Refresh on a non-default tab — should persist the tab selection

**Risk notes:** The insights page has optimistic UI updates with `useTransition` and `router.refresh()`. Ensure tab switching doesn't interfere with the insight status workflow (Mark as Read, To-Do, etc.). Also verify the Kanban board view toggle still works within the Feed tab.

---

### Ticket 2.2: ALT-38 — Menu & Website sub-tabs don't switch content

**Priority:** Medium | **Type:** Bug | **Risk:** Medium

**What's broken:** Same pattern as ALT-34 but on the Content page. Website/Menu/Compare sub-tabs may not switch content.

**Codebase context:**
- `app/(dashboard)/content/page.tsx` — Content page
- `components/content/menu-viewer.tsx` — Menu tab content
- `components/content/menu-compare.tsx` — Compare tab content

**Implementation steps for Cursor:**

```
1. Apply the same diagnosis as ALT-34 to the Content page
2. Open `app/(dashboard)/content/page.tsx`
3. Check tab routing mechanism — likely the same pattern as insights
4. Ensure Website, Menu, and Compare tabs each render their respective component
5. This is likely the exact same bug pattern — once you fix ALT-34, apply the same fix here
```

**Testing:**
- Click Website — should show tracked URL and iframe preview
- Click Menu — should show menu-viewer with categories/items
- Click Compare — should show side-by-side menu comparison

**Risk notes:** Same as ALT-34. The fix pattern should be identical — apply it consistently.

---

### Ticket 2.3: ALT-37 — Weather stat cards show N/A while chart has real data

**Priority:** Medium | **Type:** Bug | **Risk:** Low

**What's broken:** Weather page stat cards show "Current Conditions: N/A", "Avg High Temp: 0°F" while the chart below shows real forecast data (60-95°F). The stat cards aren't reading from the same data source as the chart.

**Codebase context:**
- `app/(dashboard)/weather/page.tsx` — Weather page (server component)
- `components/weather/location-weather-cards.tsx` — the stat cards
- `components/weather/weather-history.tsx` — the chart
- `lib/weather/google.ts` — `fetchCurrentConditions()` → `WeatherSnapshot`
- `lib/providers/openweathermap.ts` — historical + forecast weather
- `lib/cache/weather.ts` — cached weather data

**Implementation steps for Cursor:**

```
1. Open `app/(dashboard)/weather/page.tsx` — see what data is passed to the stat cards vs. the chart
2. The chart likely reads from `location_weather` table (OpenWeatherMap forecast data)
3. The stat cards likely read from `fetchCurrentConditions()` (Google Weather API) which may be failing or returning empty data
4. Check if the stat cards component receives props and whether those props are populated
5. Likely fix: Either
   a. The Google Weather API call is failing silently — check error handling in `lib/weather/google.ts`
   b. The stat cards are looking for data in a different format than what's stored
   c. The stat cards should derive their values from the same forecast data the chart uses (e.g., latest forecast day's high temp, current conditions from the most recent data point)
6. If Google Weather API is unreliable, consider deriving stat card values from OpenWeatherMap data:
   - Current Conditions: latest forecast entry's description
   - Avg High Temp: average of forecast high temps
   - Total Precipitation: sum of forecast precipitation
   - Severe Weather Days: count of severe weather entries
```

**Testing:**
- Navigate to Weather page — stat cards should show real values matching the chart data
- Test with a location that has weather data — values should be non-zero
- Test with a location that has NO weather data — should show appropriate empty state

**Risk notes:** Low. The weather cards and chart are separate components. Fixing the data binding for cards won't affect the chart. Just ensure the data source is consistent.

---

### Ticket 2.4: ALT-35 — Generate Insights reports success but produces no insights

**Priority:** Medium | **Type:** Bug (downgraded to UX) | **Risk:** Low

**What's broken:** The "Generate Insights" button shows a success toast immediately but no insights appear. They DO appear after ~10-15 minutes of background enrichment. The issue is missing loading/progress state.

**Codebase context:**
- `app/(dashboard)/insights/page.tsx` — Insights page
- `lib/jobs/pipelines/insights.ts` — Insights pipeline
- `components/ui/job-refresh-button.tsx` — Refresh button with SSE streaming
- `components/ui/active-job-bar.tsx` — Global job status bar

**Implementation steps for Cursor:**

```
1. This is NOT a code bug — it's a UX gap. The insight pipeline works correctly but there's no indication that background enrichment is happening.
2. When "Generate Insights" is clicked, the SSE-based job system should already be tracking it via `refresh_jobs` table
3. Check if the insights page uses `<JobRefreshButton />` — if not, replace the plain button with it
4. Verify `<ActiveJobBar />` is included in the dashboard layout and polls for active jobs
5. If the button is already a JobRefreshButton, the issue may be that:
   a. The insights pipeline completes "fast" (marks the job done) but the actual data enrichment runs as fire-and-forget background tasks
   b. The SSE stream closes before enrichment finishes
6. Quick fix: After the "Generate Insights" job completes, show a toast or inline message: "Insights generated. Data enrichment is running in the background — new insights will appear as data arrives."
7. Better fix: Track enrichment status and show progress (this overlaps with ALT-57)
```

**Testing:**
- Click "Generate Insights" — should show progress/status, not just a success toast
- Wait for enrichment — insights should populate without manual page refresh

**Risk notes:** Low. This is additive UX — no existing functionality changes.

---

## Sprint 3: Landing Page & Marketing Fixes

**Why third:** These bugs affect the public-facing marketing site. They're visible to prospective customers but don't affect existing users' data or functionality.

---

### Ticket 3.1: ALT-21 — Contradictory signal count metrics across homepage

**Priority:** High | **Type:** Bug | **Risk:** Low

**What's broken:** Hero claims "10,000+ signals daily" but the stats section shows "168+" or "135+" — three different numbers for the same metric. Numbers also change on refresh (counter animation artifacts).

**Codebase context:**
- `components/landing/hero-section.tsx` — hero stats
- `components/landing/trust-section.tsx` — animated counter infographic (4 metrics count up on scroll via Framer Motion)

**Implementation steps for Cursor:**

```
1. Open `components/landing/hero-section.tsx` — find the "10,000+ SIGNALS DAILY" text
2. Open `components/landing/trust-section.tsx` — find the counter animation
3. Decide on canonical numbers with the team — these should be consistent and defensible
4. Hardcode the canonical values in a single constants object:
   const MARKETING_STATS = {
     signalsDaily: "10,000+",
     insightTypes: "50+",
     intelChannels: "6",
     competitors: "...",
   }
5. Import this constant in both hero-section.tsx and trust-section.tsx
6. For the counter animation: ensure the animation counts UP to the target value, starting from 0 — not from a random base
7. Use the `countUp` pattern: animate from 0 to the target number over ~2 seconds on scroll-into-view
```

**Testing:**
- Load homepage — hero stats should match trust section stats
- Scroll to trigger counter animation — numbers should count up to the correct target
- Refresh page — numbers should be consistent

**Risk notes:** Very low. These are presentational components on the marketing page. Zero impact on the dashboard.

---

### Ticket 3.2: ALT-20 — All four footer links are dead (href='#')

**Priority:** High | **Type:** Bug | **Risk:** Low

**What's broken:** Footer links (Privacy Protocol, Terms of Intelligence, API Docs, Contact Analyst) all use `href="#"`.

**Codebase context:**
- `components/landing/waitlist-section.tsx` — contains the footer

**Implementation steps for Cursor:**

```
1. Open `components/landing/waitlist-section.tsx` — find the footer links
2. Decision needed: Do these pages exist?
   - If YES: Update hrefs to correct paths (/privacy, /terms, /api-docs, /contact)
   - If NO (most likely): Either:
     a. Remove the links entirely (cleanest)
     b. Point them to placeholder pages with "Coming Soon" content
     c. Link to external pages (e.g., Alive Labs legal pages)
3. If removing: Keep the footer but simplify to "© 2026 Alive Labs" (also fixes ALT-27)
4. If keeping with placeholders: Create simple pages at `app/(marketing)/privacy/page.tsx` etc.
```

**Testing:**
- Click each footer link — should navigate to a real page (not #)
- Each target page should render properly with navigation back to the homepage

**Risk notes:** Very low. Static marketing content change.

---

### Ticket 3.3: ALT-27 — Footer copyright says 'VATIC INTELLIGENCE'

**Priority:** Low | **Type:** Bug | **Risk:** Low

**What's broken:** Footer shows "© 2026 VATIC INTELLIGENCE" — not a recognized Alive Labs entity.

**Codebase context:**
- `components/landing/waitlist-section.tsx` — footer section

**Implementation steps for Cursor:**

```
1. Open `components/landing/waitlist-section.tsx`
2. Find the copyright text
3. Change "© 2026 VATIC INTELLIGENCE" to "© 2026 Alive Labs" (or whatever the team confirms as the correct legal entity)
4. Bundle this with ALT-20 — it's in the same file
```

**Testing:**
- Load homepage, scroll to footer — should show correct entity name

**Risk notes:** Zero. One-line text change.

---

### Ticket 3.4: ALT-26 — 404 page is unstyled Next.js default

**Priority:** Low | **Type:** Bug | **Risk:** Low

**What's broken:** Navigating to an invalid URL shows the bare Next.js default 404 page.

**Codebase context:**
- Next.js 16 uses `app/not-found.tsx` for custom 404 pages
- No `not-found.tsx` exists in the codebase currently

**Implementation steps for Cursor:**

```
1. Create `app/not-found.tsx`
2. Import the landing page nav or a minimal branded header
3. Render a centered message:
   - Heading: "Page not found"
   - Subtext: "The page you're looking for doesn't exist or has been moved."
   - CTA button: "Go to homepage" → link to "/"
4. Apply the same dark theme/glass panel styling used on the login/signup pages
5. Ensure dark/light mode works
```

**Testing:**
- Navigate to `/anything-invalid` — should show branded 404 page
- Click "Go to homepage" — should navigate to `/`

**Risk notes:** Zero. New file, no existing files modified.

---

## Sprint 4: Feature Work (Medium Priority)

**Why fourth:** These are feature additions that improve the user experience but aren't fixing broken functionality.

---

### Ticket 4.1: ALT-57 — Add global processing/enrichment status indicator

**Priority:** Medium | **Type:** Feature | **Risk:** Medium

**What's broken:** No visible indicator when background data enrichment runs after approving competitors or clicking "Refresh All Data." Root cause of false "Generate Insights broken" report (ALT-35).

**Codebase context:**
- `components/ui/active-job-bar.tsx` — existing global job status bar (polls `refresh_jobs` table)
- `lib/jobs/manager.ts` — CRUD for `refresh_jobs` table
- `lib/jobs/types.ts` — JobType, JobStatus, etc.
- `app/(dashboard)/layout.tsx` — dashboard layout (where global UI lives)

**Implementation steps for Cursor:**

```
1. Open `components/ui/active-job-bar.tsx` — understand how it currently works
2. This component already exists and polls for active jobs. The issue is likely:
   a. It's not included in the dashboard layout, OR
   b. Fire-and-forget enrichment (on competitor approval) doesn't create a trackable job
3. Open `app/(dashboard)/layout.tsx` — verify ActiveJobBar is rendered
4. Open `lib/jobs/triggers.ts` — `triggerInitialLocationData()` fires enrichment on location creation
5. Check `app/(dashboard)/competitors/actions.ts` — when a competitor is approved, does it create a `refresh_jobs` entry?
6. If not, add job creation when enrichment starts:
   - `await createJob({ organizationId, locationId, jobType: 'refresh_all', status: 'running' })`
   - Complete the job when enrichment finishes
7. Ensure ActiveJobBar shows a persistent banner: "Enriching data for [location name]... This may take a few minutes."
```

**Testing:**
- Approve a competitor — should see global status bar appear
- Click "Refresh All Data" — should see status bar with progress
- After enrichment completes — status bar should dismiss

**Risk notes:** Medium. Touches the job system which is used across all pipeline types. Ensure creating new job entries doesn't interfere with the SSE streaming system or cause duplicate job entries.

---

### Ticket 4.2: ALT-53 — Build out Settings page with actual content

**Priority:** Medium | **Type:** Feature | **Risk:** Medium

**What's broken:** Settings page shows Organization, Billing, and Team as accordion labels with no expandable content or functionality.

**Codebase context:**
- `app/(dashboard)/settings/page.tsx` — Settings page
- The blueprint notes: "Team management placeholder: `/settings/team` has no functionality"
- Organization settings and billing have existing data in the `organizations` and Stripe tables

**Implementation steps for Cursor:**

```
1. Open `app/(dashboard)/settings/page.tsx`
2. Phase 1 (this ticket): Build read-only settings display
   a. Organization section: Show org name, slug, industry type, created date
   b. Billing section: Show current tier, trial status, Stripe customer ID, link to Stripe checkout
   c. Team section: Show "Coming Soon" placeholder with a description of planned functionality
3. Use the existing card/section patterns from other dashboard pages
4. For Organization: Read from the organization data already fetched in the layout
5. For Billing: Use `TIER_LIMITS` from `lib/billing/tiers.ts` to show current plan details
6. For Team: Show current org members from `organization_members` table (read-only list)
7. Add edit capabilities for org name (via server action updating `organizations` table)
```

**Testing:**
- Navigate to Settings — should show organized sections with real data
- Organization section should show correct org name and tier
- Billing section should reflect actual Stripe status

**Risk notes:** Medium. The settings page will read from multiple data sources. Ensure all queries are org-scoped (use `getOrgLocationIds` pattern from `lib/auth/org-access.ts`). Don't build Team invite functionality yet — that's a larger feature.

---

### Ticket 4.3: ALT-47 — Add aria-live regions for dynamic data updates

**Priority:** Medium | **Type:** Design (Accessibility) | **Risk:** Low

**What's broken:** When users click "Generate Insights", "Refresh All Data", etc., status is only communicated via visual toast. Screen readers get no announcement.

**Codebase context:**
- `components/ui/active-job-bar.tsx` — job status bar
- Toast notifications use Sonner (`sonner` package)

**Implementation steps for Cursor:**

```
1. Check if Sonner toasts already include `role="status"` or `aria-live` attributes
   - Sonner v2+ typically does this by default via its Toast component
   - If so, this may already be partially fixed
2. If not, wrap the Sonner `<Toaster />` in the root layout with `role="status"` or configure Sonner's accessibility props
3. For the ActiveJobBar:
   - Add `aria-live="polite"` to the status bar container
   - Add `role="status"` to the progress text
4. For insight status changes (Mark as Read, To-Do, etc.):
   - Ensure the optimistic UI update announces the change via aria-live
5. Quick implementation:
   - In `app/(dashboard)/layout.tsx`, ensure the Sonner `<Toaster />` has `role="status"`
   - In `components/ui/active-job-bar.tsx`, add `aria-live="polite"` to the container div
```

**Testing:**
- Use a screen reader (or browser accessibility inspector)
- Click "Generate Insights" — screen reader should announce the toast
- Active job bar should be announced when it appears

**Risk notes:** Very low. Adding ARIA attributes doesn't change visual behavior.

---

## Sprint 5: Low Priority & Future Features

**Why last:** These are either low-priority polish items, placeholder UI that needs a backend first, or large features that should be their own sprint.

---

### Ticket 5.1: ALT-45 — Add aria-current to active sidebar nav item

**Priority:** Low | **Type:** Design | **Risk:** Low

**Implementation steps for Cursor:**

```
1. Find the sidebar navigation component in `app/(dashboard)/layout.tsx` or a sidebar component
2. Each nav link should use Next.js `usePathname()` to detect the current route
3. Add `aria-current="page"` to the link element when it matches the current path
4. Example: <Link href="/insights" aria-current={pathname === "/insights" ? "page" : undefined}>
```

---

### Ticket 5.2: ALT-65 — Auto-fetch data on first visit to empty pages

**Priority:** Medium | **Type:** Feature | **Risk:** Medium

**Implementation notes:** This touches `lib/jobs/triggers.ts` and multiple dashboard pages. Each empty-state page (Photos, Busy Times, Social) would need to detect "never fetched" state and trigger the appropriate job pipeline. Defer to after Sprint 4.

---

### Ticket 5.3: ALT-39 — Header search field is non-functional

**Priority:** Medium | **Type:** Bug | **Risk:** Low

**Implementation notes:** The search field is a placeholder with no event handlers. Two options:
1. **Quick fix:** Remove the search input entirely until search is implemented
2. **Build it:** Implement a command palette (Cmd+K) that searches across competitors, insights, locations, and settings. This is a medium-effort feature.

Recommend option 1 for now — remove the non-functional element to avoid confusion.

---

### Ticket 5.4: ALT-40 — Notification bell icon doesn't respond to clicks

**Priority:** Low | **Type:** Bug | **Risk:** Low

**Implementation notes:** Same pattern as ALT-39. The bell is decorative with no backend. Two options:
1. **Quick fix:** Remove the bell icon until notifications are built
2. **Build it:** Wire to insight status changes, job completions, trial reminders

Recommend option 1.

---

### Ticket 5.5: ALT-63 — Add data export capability to dashboard pages

**Priority:** Medium | **Type:** Feature | **Risk:** High

**Implementation notes:** This is a multi-page feature. Each dashboard page needs an "Export" button generating CSV/PDF. Recommend deferring to its own sprint. Admin already has CSV export API routes at `/api/admin/export/` — these patterns can be extended to user-facing exports.

---

### Ticket 5.6: ALT-64 — Add team sharing and collaboration on insights

**Priority:** Low | **Type:** Feature | **Risk:** High

**Implementation notes:** Requires the Team management system to be built first (currently placeholder). Defer entirely — this depends on multi-user team invites, role-based access within insights, and notification infrastructure.

---

## Dependency Map

```
ALT-28 (autocomplete) ──→ ALT-29 (suggestions) ──→ ALT-31 (zero competitors)
                                                  ↑
ALT-30 (keyword search) ─────────────────────────┘

ALT-34 (insights tabs) ──→ ALT-38 (content tabs)   [Same bug pattern]

ALT-35 (insights UX) ────→ ALT-57 (status indicator)  [57 is the proper fix for 35]

ALT-20 (footer links) ───→ ALT-27 (footer copyright)  [Same file]
                          ↑
ALT-26 (404 page) ───────┘  [Related: footer links → 404]

ALT-47 (aria-live) ──────→ ALT-45 (aria-current)  [Same accessibility sprint]

ALT-53 (settings) ───────→ ALT-64 (team sharing)  [64 depends on 53]

ALT-39 (search) ─────────→ Independent
ALT-40 (bell) ───────────→ Independent
ALT-65 (auto-fetch) ─────→ Independent
ALT-63 (export) ──────────→ Independent
```

---

## Sprint Timeline Estimate

| Sprint | Tickets | Estimated Days | Focus |
|--------|---------|----------------|-------|
| Sprint 1 | ALT-28, 29, 31, 30 | 2-3 days | Onboarding critical path |
| Sprint 2 | ALT-34, 38, 37, 35 | 2-3 days | Dashboard data display |
| Sprint 3 | ALT-21, 20, 27, 26 | 1-2 days | Landing page polish |
| Sprint 4 | ALT-57, 53, 47 | 3-4 days | Features + accessibility |
| Sprint 5 | ALT-45, 65, 39, 40, 63, 64 | Backlog | Low priority + large features |

**Total estimated: ~10-12 working days for Sprints 1-4** (the actionable work).

---

## Pre-Flight Checklist (Before Starting Any Ticket)

1. ☐ Pull latest from `feature-anand` branch
2. ☐ Run `npm install` (in case dependencies changed)
3. ☐ Run `npm run build` — ensure clean baseline
4. ☐ Verify `.env.local` has all required variables (Section 3 of BLUEPRINT.md)
5. ☐ Have at least one test account with: 1 organization, 1 location, 1+ approved competitors
6. ☐ Test in Chrome + Firefox (at minimum)
7. ☐ Test in dark mode (primary) and light mode

## Post-Ticket Checklist (After Completing Each Ticket)

1. ☐ `npm run build` passes with zero errors
2. ☐ `npm run lint` passes
3. ☐ Manually test the specific fix in the browser
4. ☐ Test adjacent pages/features that share the modified components
5. ☐ Commit with ticket ID in message: `fix(ALT-28): add location bias to autocomplete`
6. ☐ Push to `feature-anand`

---

*Generated April 15, 2026. This PRD should be used alongside BLUEPRINT.md (codebase reference) and the GitHub repo for file-level implementation.*
