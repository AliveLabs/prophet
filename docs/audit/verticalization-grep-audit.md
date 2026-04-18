# Verticalization Grep Audit
> Generated: 2026-04-11
> Branch: feature/verticalization (off dev)

## restaurantName / restaurant_name references (5 files)
- `app/onboarding/steps/restaurant-info.tsx` (prop interface, JSX binding)
- `app/onboarding/onboarding-wizard.tsx` (state var, setters, props to steps)
- `app/onboarding/actions.ts` (CreateOrgInput.restaurantName, slug, org name, location name)
- `app/onboarding/steps/loading-brief.tsx` (prop interface, display)
- `lib/ai/gemini.ts` (function param restaurantName in extractMenuViaGemini)

## Menu types (MenuType, MenuCategory, MenuSnapshot, DetectedFeatures) (15 files)
### Canonical definitions: `lib/content/types.ts`
### Importers:
- `lib/content/normalize.ts`
- `lib/content/menu-parse.ts`
- `lib/content/insights.ts`
- `lib/content/enrich.ts`
- `app/(dashboard)/content/actions.ts`
- `app/(dashboard)/content/page.tsx`
- `app/(dashboard)/insights/actions.ts`
- `app/(dashboard)/locations/page.tsx`
- `lib/jobs/pipelines/content.ts`
- `lib/jobs/pipelines/insights.ts`
- `lib/jobs/triggers.ts`
- `lib/ai/gemini.ts`

### Local redefinitions (do NOT import from types.ts):
- `components/content/menu-viewer.tsx` — MenuType, MenuCategory redefined locally
- `components/content/menu-compare.tsx` — MenuType, MenuCategory redefined locally

## CUISINES / cuisine (3 files)
- `app/onboarding/steps/restaurant-info.tsx` — CUISINES array, cuisine prop
- `app/onboarding/actions.ts` — cuisine field in CreateOrgInput
- `app/onboarding/onboarding-wizard.tsx` — cuisine state, setCuisine

## detectFeatures (1 file)
- `lib/content/normalize.ts` — defined (line 111), called (line 146)

## Organizations table queries (30+ files)
> All use `.from("organizations")` via Supabase client.
Key insert sites:
- `app/onboarding/actions.ts` lines ~59, ~264 (createOrganizationAction, createOrgAndLocationAction)
- `app/actions/waitlist.ts` line ~90 (approveWaitlistSignup)

## Existing industry/vertical references
- Only Recharts `layout="vertical"` props — no business vertical code exists.

## Summary
- **5 files** need `restaurantName` → `businessName` rename
- **15 files** reference menu types; 2 have local redefinitions
- **3 files** reference CUISINES/cuisine
- **1 file** defines detectFeatures
- **30+ files** query the organizations table (all safe with DEFAULT column)
- **0 files** have existing vertical/industry logic
