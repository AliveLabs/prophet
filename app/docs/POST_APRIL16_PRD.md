# Vatic — Post-April 16 Meeting PRD (Cursor-Ready)

> **Author:** Anand Iyer
> **Date:** April 17, 2026
> **Status:** Locked — Ready for Cursor Execution
> **Supersedes:** VERTICALIZATION_V2.md Phases 3, 4, 8, 10 (subdomain routing approach is dead)
> **Preserves:** VERTICALIZATION_V2.md Phases 0, 1, 2, 5, 6, 7, 11 (schema, config, chrome, email, Stripe, content intel remain valid)
> **Purpose:** Translate the April 16 meeting decisions into a sequenced, Cursor-ready implementation plan. This document is the single source of truth for the next 4 to 6 weeks of work.

---

## 0. What Changed on April 16

The April 16 product call reversed one major architectural decision from VERTICALIZATION_V2.md and locked five new ones. Read this section first. Everything downstream assumes you have internalized this shift.

### 0.1 The Architectural Reversal

**Before (VERTICALIZATION_V2.md):** Single codebase, subdomain routing, `ticket.thevatic.ai` and `neat.thevatic.ai` served from one Vercel project with middleware resolving `industry_type` from hostname.

**After (April 16):** Clone the codebase per vertical. Each vertical is its own Vercel project, its own database (eventually), its own deployment pipeline. Ticket stays on the current production codebase (rebranded from generic Vatic to Ticket). Neat is a full clone of that repo when we are ready to launch it.

**Why the reversal:** Bryan and Anand walked through the failure modes of shared auth across subdomains (Stripe customers straddling two verticals, transactional emails with the wrong domain, session cookies crossing subdomains, a single user owning both a restaurant and a liquor brand). The conclusion: subdomain routing pushes the complexity onto the customer. Cloning pushes the complexity onto us. Customer-facing simplicity wins.

### 0.2 The Five Locked Decisions

1. **Production becomes Ticket.** The current Vatic production environment gets rebranded to Ticket. Vatic branding stays only in `thevatic.ai` (the platform marketing site, still out of scope for this doc) and internal admin tools.

2. **`vatic-core` repo exists as a backup and foundation.** The current production repo gets forked into a clean `vatic-core` repository before any Ticket-specific changes land. `vatic-core` is the pristine foundation. Future verticals clone from `vatic-core`, not from the Ticket repo.

3. **Verticalization work is preserved, repurposed as theming.** The `lib/verticals/`, `data-brand` CSS scoping, `BrandProvider`, `useChartColors`, `VERTICALIZATION_ENABLED` flag — all of it stays. It becomes the theming and feature-gating layer. `VERTICALIZATION_ENABLED` stays `false` in production so the flag becomes the on-switch for future experiments without shipping them to customers.

4. **Dynamic string variables replace hardcoded domain language.** Signal names, section titles, status messages, and any other restaurant-specific terminology get externalized to a JSON mapping table so A/B testing and future vertical-specific copy is a file edit, not a code change.

5. **Marketing contact forms become the waitlist.** `getticket.ai` (and later `goneat.ai`) submit directly to the Vatic app's waitlist API. No CRM. No separate mailing list tool. The waitlist row triggers a Resend drip sequence that Chris is building. Final admin approval is the access-grant trigger.

### 0.3 What This Means For Your Next Four Weeks

The old 12-phase VERTICALIZATION_V2.md roadmap is partially obsolete. Here is what survives, what dies, and what is new:

| VERTICALIZATION_V2 Phase | Status | Reason |
|---|---|---|
| Phase 0 — Branch and safety net | **Done / Skip** | You have been working in branches continuously |
| Phase 1 — Schema foundation (`industry_type`) | **Done** | Migration `20260412010100_add_industry_type.sql` shipped |
| Phase 2 — Vertical config layer | **Done** | `lib/verticals/` exists with restaurant and liquor-store configs |
| Phase 3 — Subdomain routing and middleware | **Dead** | Replaced by clone-per-vertical |
| Phase 4 — Onboarding generalization | **Partial / Keep** | Onboarding is already vertical-aware via `?vertical=` query param |
| Phase 5 — Per-vertical dashboard chrome | **Done** | `BrandProvider`, `data-brand`, `useChartColors` shipped |
| Phase 6 — Email templates per vertical | **Defer** | Ticket-only for now; Neat gets its own clone with its own templates |
| Phase 7 — Stripe restructuring | **Defer** | Keep current Stripe setup. When Neat clones, it gets its own Stripe account |
| Phase 8 — Marketing sites lift-and-shift | **Rescope** | `getticket.ai` marketing site is in scope; `goneat.ai` waits for Neat clone |
| Phase 9 — Vatic app root cleanup | **Rename / Keep** | This is now "rebrand Vatic production to Ticket" |
| Phase 10 — Neat shell launch | **Defer** | Happens via repo clone, not via Vercel project add |
| Phase 11 — Liquor content intelligence | **Defer** | Not blocking anything until Neat repo is cloned |
| Phase 12 — OpenRouter migration | **Defer** | Nice-to-have, not blocking |

### 0.4 What Is Actually Next

Five discrete workstreams, sequenced by dependency:

1. **Stop the bleeding.** Pause the current client-facing email flow so marketing (Chris's Resend drip) can take over without conflict.
2. **Create the backup.** Fork the current repo into `vatic-core` as a pristine foundation before Ticket-specific changes land.
3. **Rebrand production to Ticket.** Apply the Ticket theme at the root of production, not behind a feature flag.
4. **Externalize domain language.** Move hardcoded restaurant-specific terminology into a JSON mapping layer.
5. **Wire the marketing waitlist.** Point the `getticket.ai` contact form at the Vatic app's waitlist API and make sure Chris's Resend drip is what fires, not the current platform-side confirmation email.

The rest of the meeting action items (Notion open-questions flow, daily ticket job, Alive Labs rebrand, Claude skill sharing) are adjacent work that is not blocked by and does not block this sequence. They get their own short section at the end.

---

## 1. Guiding Principles for This Phase

1. **Additive, not destructive.** Every migration is additive. Every code change is reversible. Nothing in production breaks during any single commit.
2. **Ticket relaunch is the milestone that matters.** Neat does not ship in this phase. Every decision that is Neat-specific gets deferred.
3. **Theming stays, verticalization flag stays off in production.** `VERTICALIZATION_ENABLED=false` in production env vars. The machinery is there for when we need it. We do not ship Neat-flavored behavior to Ticket customers.
4. **No destructive Resend changes.** Pause the platform-side transactional flow by commenting it out or gating it behind an env flag. Do not delete templates. Chris owns the marketing-side drip sequences; the platform owns the post-approval welcome email only.
5. **`vatic-core` is sacred.** It has a `CLAUDE.md` at the root telling Claude not to modify it. It is a backup and a seed. It never accepts direct feature commits.

---

## 2. Workstream 1 — Pause Platform-Side Client Emails

**Goal:** Stop the Vatic app from sending any client-facing email until the admin explicitly approves a waitlist signup. This prevents collision with Chris's marketing-side Resend drip sequence.

**Why this is workstream 1:** It is the cheapest, fastest, lowest-risk change. It also unblocks Chris to start configuring Resend sequences against the waitlist without worrying about duplicate or conflicting emails landing in user inboxes.

**What stays on:** The admin notification email to `chris@alivelabs.io` when a new waitlist signup arrives. That is internal, not client-facing.

**What pauses:** Waitlist confirmation email, any trial reminders that reference marketing language, welcome emails that go out before admin approval.

**What stays on post-approval:** The waitlist invitation email with the magic link that admin triggers on approval. That is the access-grant email. Chris's drip stops when that email fires.

### 2.1 Cursor instructions

```
Open the Vatic production codebase.

Goal: Gate all client-facing transactional emails behind an env flag so
we can pause them without deleting templates or routes.

Step 1. Add a new env variable CLIENT_EMAILS_ENABLED to the email sender
module. Default value: "false" in production, "true" in dev and preview.

Step 2. Locate the central Resend send function. Based on the blueprint,
the email module likely lives at one of:
- lib/email/send.ts
- lib/email/resend.ts
- lib/resend/send.ts

Use grep to find it. Search for `resend.emails.send` or `Resend` imports.

Step 3. In that central send function, add an early return guard:

  if (process.env.CLIENT_EMAILS_ENABLED !== 'true' && isClientFacing) {
    console.log('[email] Client-facing email paused:', template, to);
    return { paused: true };
  }

Classify each of the existing templates as client-facing or internal.
Client-facing templates include:
- waitlist-confirmation
- waitlist-invitation (PAUSED until admin approval; see note below)
- waitlist-decline
- welcome
- trial-3day-reminder
- trial-1day-reminder
- trial-expired

Internal templates that stay on:
- admin-notification-new-signup (goes to chris@alivelabs.io)

IMPORTANT EXCEPTION: The waitlist-invitation email must still fire when
the admin manually approves a signup from /admin/waitlist. That is an
admin-initiated action, not a passive platform email. Add an
`overrideClientEmailPause: true` parameter to the send function that the
admin approval action passes explicitly.

Step 4. Update .env.example to document the new variable. Update the
production Vercel env vars via the Vercel dashboard (do this manually
after merging — do not touch Vercel from Cursor).

Step 5. Add a log line to the admin dashboard analytics view so we can
see "X client emails paused in last 24h" to verify the gate is working.

Do NOT:
- Delete any email template files
- Remove any send calls
- Change the admin-notification flow
- Touch Chris's Resend account configuration
```

### 2.2 Verification checklist

- [ ] `CLIENT_EMAILS_ENABLED=false` is set in production Vercel env vars
- [ ] New waitlist signup creates a pending row AND still fires the admin notification to `chris@alivelabs.io`
- [ ] New waitlist signup does NOT fire the waitlist confirmation to the signup email
- [ ] Admin approval in `/admin/waitlist` DOES fire the invitation email (override path works)
- [ ] Trial reminder cron, if it runs, logs paused emails instead of sending them
- [ ] Dev environment still sends all emails (`CLIENT_EMAILS_ENABLED=true` locally)

### 2.3 Rollback

Set `CLIENT_EMAILS_ENABLED=true` in Vercel and redeploy. Takes 2 minutes.

---

## 3. Workstream 2 — Create `vatic-core` Backup Repository

**Goal:** Fork the current production repo into a new `vatic-core` GitHub repository that acts as the pristine foundation for all future verticals. It is a backup and a seed. It never accepts direct feature work.

**Why this is workstream 2:** It needs to happen before any Ticket-specific rebrand changes land. The whole point of `vatic-core` is to capture the codebase in its current, vertical-agnostic state so that when we clone for Neat later, we start from a clean foundation rather than ripping Ticket-isms out of a restaurant-branded codebase.

### 3.1 Pre-flight cleanup of the current repo

Before creating the fork, clean up the clutter in the current repo's `docs/` folder. The April 16 meeting noted there are ~52 saved plans, three versions of verticalization docs, and multiple brand guideline backups. Consolidate.

### 3.2 Cursor instructions

```
PART A — Clean up docs folder before forking.

Open the current Vatic production repo.

Navigate to the docs folder at the repo root. List all files.

Apply these rules:
- Keep: BLUEPRINT.md (current, definitive technical reference)
- Keep: VERTICALIZATION_V2.md (superseded by POST_APRIL16_PRD.md but
  preserved as a historical record)
- Keep: POST_APRIL16_PRD.md (this document, once saved)
- Move to docs/archive/: All older PRD versions, all dated brand
  guideline drafts older than April 1, 2026, all migration plans that
  reference completed work, all Claude conversation exports
- Delete: Exact duplicates of any file (check file hash, not filename)

Commit the cleanup as a single commit with message:
"docs: archive historical PRDs and consolidate docs folder"

Do NOT delete any file that does not have an exact duplicate. When in
doubt, move it to docs/archive/ instead of deleting.

PART B — Create the vatic-core repo.

Via the GitHub web UI (not Cursor), create a new private repository
named `vatic-core` under the company GitHub organization.

Do NOT initialize it with a README (we will push our own).

Back in Cursor, from the root of the current production repo, run:

  git remote add vatic-core git@github.com:<org>/vatic-core.git
  git push vatic-core main:main

This pushes the current main branch as the initial commit of vatic-core.

PART C — Add the anti-modification guard files.

On your local machine, clone vatic-core fresh into a sibling directory:

  cd ..
  git clone git@github.com:<org>/vatic-core.git
  cd vatic-core

Create a new file at the root called CLAUDE.md with the following content:

---
# ⚠️ vatic-core — DO NOT MODIFY DIRECTLY ⚠️

This repository is the pristine foundation for all Vatic-powered verticals.
It is NOT a working repository. It accepts no feature commits.

## Rules for Claude (and any AI coding assistant)

**If the user asks you to modify this repository, STOP. Ask them:**

1. "Are you sure? This is vatic-core. It is supposed to be the clean
   foundation that future verticals clone from."
2. "Did you mean to work in the Ticket repo or a feature branch?"
3. "If you truly intend to update the core foundation, confirm by typing
   'I am updating vatic-core intentionally'."

Do not proceed until the user types that exact phrase.

## What changes to vatic-core are legitimate?

Only three things ever change here:

1. Security patches that apply to every vertical (e.g., a critical
   Supabase client bug, a CORS hole, a Stripe webhook signing fix).
2. Infrastructure-level dependency updates (Next.js major version bumps,
   Supabase client version bumps).
3. New shared primitives that we have CONFIRMED belong in the core,
   after a vertical has shipped them first and proven they generalize.

## What never changes here?

- Vertical-specific branding, copy, colors, or theming
- Vertical-specific insight rules or prompts
- Stripe price IDs or billing logic tied to a specific Stripe account
- Domain-specific terminology (restaurant menus, liquor catalogs, etc.)

## How to create a new vertical

1. Clone vatic-core into a new repository (e.g., `vatic-neat`).
2. Apply the vertical's theme, copy, and domain language.
3. Configure its own Supabase project, Stripe account, and Vercel deploy.
4. Never merge the new vertical's feature work back into vatic-core.

---
END OF CLAUDE.md
---

Also create a README.md at the root with a short human-readable version
of the above rules and a link to POST_APRIL16_PRD.md.

Commit both files:

  git add CLAUDE.md README.md
  git commit -m "core: add anti-modification guard and README"
  git push origin main

PART D — Protect the main branch.

Via the GitHub web UI, go to vatic-core settings → Branches. Add a
branch protection rule for `main`:
- Require pull request before merging
- Require 1 approval
- Restrict who can push to matching branches (only repo admins)
- Do not allow force pushes

This is the human-layer backup to the AI-layer CLAUDE.md guard.
```

### 3.3 Verification checklist

- [ ] `vatic-core` repo exists on GitHub, private, owned by the company org
- [ ] Initial commit of `vatic-core` matches current Vatic production `main` branch
- [ ] `CLAUDE.md` exists at the root with the anti-modification prompt
- [ ] `README.md` exists at the root with a short human-readable version
- [ ] Branch protection is enabled on `vatic-core` main
- [ ] The Ticket production repo's `docs/` folder is cleaned up and the archive is in `docs/archive/`

### 3.4 What happens next with `vatic-core`

Nothing, for now. It sits. When we are ready to build Neat, the first action is `git clone vatic-core vatic-neat`, not branching off the Ticket repo.

---

## 4. Workstream 3 — Rebrand Production Root to Ticket

**Goal:** Apply Ticket branding (logo, wordmark, colors, fonts, copy) to the production Vatic app as the default experience, not behind a feature flag. The logged-in app at the current production URL should feel like Ticket, not generic Vatic.

**Why this is workstream 3:** It is the highest-visibility user-facing change. It also depends on the theming work that is already shipped (`data-brand`, `BrandProvider`, `useChartColors`), which means the heavy lifting is done. This phase is mostly flipping defaults and sweeping residual Vatic references out of customer-facing surfaces.

### 4.1 What stays Vatic

These surfaces keep Vatic branding because they are not customer-facing:
- `/admin/*` routes (platform admin dashboard)
- Internal docs
- `CLAUDE.md` files
- Investor pitch materials
- Future `thevatic.ai` root marketing site (not in scope here)

### 4.2 What becomes Ticket

Everything else the logged-in customer sees:
- Login page (`/login`, `/signup`)
- Dashboard header, sidebar, wordmark
- Browser tab title (`<title>`)
- Meta tags (Open Graph, Twitter, favicon)
- Email "from" name (post-approval welcome only, since other client emails are paused)
- Stripe checkout page labeling
- Onboarding flow
- Marketing landing page at `/` (still served by the Vatic app until `getticket.ai` is stood up separately)

### 4.3 Cursor instructions

```
PART A — Set data-brand="ticket" as the default at the HTML root.

Open components/brand-provider.tsx.

Current behavior: It reads `org.industry_type` for dashboard pages and
`?vertical=` for onboarding, and only sets data-brand when
VERTICALIZATION_ENABLED=true.

New behavior: Default to `data-brand="ticket"` on the <html> element
always, regardless of VERTICALIZATION_ENABLED. Keep the existing override
logic for when VERTICALIZATION_ENABLED=true (so future vertical work
still uses the machinery).

Change the BrandProvider useEffect to something like:

  useEffect(() => {
    const html = document.documentElement;
    const explicitVertical = process.env.VERTICALIZATION_ENABLED === 'true'
      ? resolveVerticalFromContext()
      : null;
    html.setAttribute('data-brand', explicitVertical ?? 'ticket');
  }, []);

Confirm that `ticket-theme.css` is imported in app/globals.css or
app/layout.tsx so the Ticket tokens actually load.

PART B — Update metadata.

In app/layout.tsx (root layout), update the `metadata` export:

  export const metadata: Metadata = {
    title: {
      default: 'Ticket — Competitive Intelligence for Restaurants',
      template: '%s | Ticket',
    },
    description: 'Daily competitive intelligence for restaurant operators...',
    openGraph: {
      title: 'Ticket',
      siteName: 'Ticket',
      // ... keep existing url, images, etc.
    },
    twitter: {
      title: 'Ticket',
      card: 'summary_large_image',
    },
    icons: {
      icon: '/ticket-favicon.ico',
      apple: '/ticket-apple-icon.png',
    },
  }

Replace favicon and apple-touch-icon files in public/ with Ticket
versions. If Bryan has not shipped Ticket favicons yet, create a ticket
in Notion and use the existing Vatic favicon as a placeholder.

PART C — Sweep hardcoded "Vatic" strings in customer-facing surfaces.

Run a full-project grep:

  grep -rn "Vatic\|vatic" --include="*.tsx" --include="*.ts" \
    --exclude-dir=node_modules --exclude-dir=.next \
    --exclude-dir=supabase --exclude-dir=docs

For each match, classify:
- Customer-facing UI string → replace with "Ticket" or the
  vertical-resolved wordmark from getVerticalConfig()
- Internal variable/function name → leave alone
- Admin panel string → leave alone
- Email template string → handle in workstream 4 (string variables)
- Comment or JSDoc → leave alone
- CSS class name (e.g., vatic-gradient, vatic-indigo) → leave alone,
  these are design tokens aliased in globals.css

Common hits you will need to update:
- Dashboard sidebar wordmark component
- Login page heading "Sign in to Vatic" → "Sign in to Ticket"
- Signup page heading
- Empty state messages that reference "Vatic"
- Toast messages that reference "Vatic"
- Footer on the marketing landing page at /

PART D — Update the marketing landing page at /.

The homepage currently serves as the marketing landing for Vatic. It
needs to be rebranded to Ticket until getticket.ai is stood up
separately (that is workstream 5).

Update hero copy, feature descriptions, testimonials, pricing tier
names if they reference Vatic. Keep any restaurant-specific copy as-is
(that is the whole point of Ticket).

Leave the waitlist form logic untouched — that is workstream 5.

PART E — Update the admin-notification email template.

The admin notification to chris@alivelabs.io can reference Ticket now.
Update the template so the subject line reads something like:
"New Ticket waitlist signup: [name] from [business]"

Everything else (from-name "Ticket Platform", body copy) should say
Ticket.

PART F — Verify the build.

Run:
  npm run build

Fix any TypeScript errors. Common ones:
- Missing imports after component renames
- Strict mode complaints about metadata object shape

Run:
  npm run dev

Log in. Walk through:
- / (landing page)
- /login
- /signup
- /onboarding
- /dashboard
- /insights
- /competitors
- /admin (should still say Vatic, not Ticket)

Every customer-facing surface should feel Ticket-branded. Admin should
still feel Vatic.

Do NOT:
- Delete ticket-theme.css or neat-theme.css
- Remove the liquor-store vertical config
- Change anything in lib/verticals/ (the machinery stays)
- Touch VERTICALIZATION_ENABLED flag — it stays false in production
```

### 4.4 Verification checklist

- [ ] `data-brand="ticket"` is present on `<html>` on every customer-facing page
- [ ] Browser tab title reads "Ticket — ..." on every customer-facing page
- [ ] Favicon is Ticket-branded (or placeholder flagged in Notion)
- [ ] Grep for `Vatic` in `app/` and `components/` returns zero customer-facing string hits
- [ ] Admin dashboard at `/admin` still reads Vatic
- [ ] Onboarding wizard reads Ticket end-to-end
- [ ] Dashboard sidebar shows Ticket wordmark
- [ ] `/login` and `/signup` read Ticket
- [ ] Email admin notification subject references Ticket
- [ ] Production build succeeds with no TypeScript errors
- [ ] `VERTICALIZATION_ENABLED` env var is still `false` in production

### 4.5 Rollback

Set `data-brand="vatic"` as default in `BrandProvider` (or remove the attribute entirely) and redeploy. Takes 5 minutes.

---

## 5. Workstream 4 — Externalize Domain Language into String Variables

**Goal:** Move restaurant-specific terminology out of hardcoded JSX and into a JSON mapping file keyed by `industry_type`. This enables A/B testing of copy, easier translation down the line, and painless vertical-specific copy when Neat clones.

**Why this is workstream 4:** It is not blocking the Ticket relaunch, but it is the right time to do it because the rebrand sweep in workstream 3 naturally surfaces where domain language is hardcoded. Catch the restaurant-isms while they are in front of you.

### 5.1 What gets externalized

| Category | Examples |
|---|---|
| Signal names | "Menu changes", "Foot traffic", "Reviews" → generic labels like "Content changes", "Busy times", "Feedback" |
| Section titles | "Restaurants in your area", "Menu intelligence", "Catering flows" |
| Empty states | "No competitors yet — add your first restaurant", "Menu extraction in progress" |
| Call-to-actions | "Track a restaurant", "Compare menus", "See which dishes are trending" |
| Notification/toast copy | "New competitor restaurant added", "Menu snapshot complete" |
| Onboarding microcopy | "What type of restaurant are you?", "Tell us about your cuisine" |

### 5.2 What does NOT get externalized

- Internal variable names, function names, type names (keep these domain-neutral where possible)
- Technical error messages (e.g., "Failed to fetch from DataForSEO")
- Admin-only copy
- Any string that is not shown to a logged-in customer

### 5.3 Cursor instructions

```
Goal: Create a JSON-driven string variable system that maps
industry_type + string key → localized display string.

PART A — File structure.

Create:

  lib/strings/
  ├── types.ts               # StringKey type, StringsDictionary interface
  ├── index.ts               # getStrings(industryType) resolver, useStrings() hook
  ├── restaurant.ts          # The restaurant string table (what Ticket ships with)
  └── liquor-store.ts        # Stub — copies restaurant values as placeholders for now

PART B — Types.

In lib/strings/types.ts, define:

  export type StringKey =
    | 'signal.content.title'
    | 'signal.content.description'
    | 'signal.busy_times.title'
    | 'signal.busy_times.description'
    | 'signal.reviews.title'
    | 'competitor.entity_label'           // "Restaurant" vs "Store"
    | 'competitor.entity_label_plural'    // "Restaurants" vs "Stores"
    | 'competitor.add_cta'                // "Track a restaurant"
    | 'onboarding.business_type_prompt'
    | 'onboarding.business_type_helper'
    | 'empty_state.competitors.title'
    | 'empty_state.competitors.cta'
    | 'toast.competitor.added'
    | 'toast.snapshot.complete'
    // ... extend as you sweep
  ;

  export type StringsDictionary = Record<StringKey, string>;

Keep the key namespace shallow and dot-separated. Do not go deeper than
three dots.

PART C — Restaurant dictionary.

In lib/strings/restaurant.ts:

  import type { StringsDictionary } from './types';

  export const restaurantStrings: StringsDictionary = {
    'signal.content.title': 'Menu intelligence',
    'signal.content.description': 'Menu items, pricing, and menu changes across competitors',
    'signal.busy_times.title': 'Busy times',
    'signal.busy_times.description': 'When competitors are busiest and how it compares to your traffic',
    'signal.reviews.title': 'Reviews',
    'competitor.entity_label': 'Restaurant',
    'competitor.entity_label_plural': 'Restaurants',
    'competitor.add_cta': 'Track a restaurant',
    'onboarding.business_type_prompt': 'What kind of restaurant is it?',
    'onboarding.business_type_helper': 'Fast casual, fine dining, QSR, cafe, bar, etc.',
    'empty_state.competitors.title': 'No restaurants tracked yet',
    'empty_state.competitors.cta': 'Add your first competitor restaurant',
    'toast.competitor.added': 'Restaurant added. We will start gathering data shortly.',
    'toast.snapshot.complete': 'Snapshot complete for all tracked restaurants.',
  };

PART D — Liquor-store stub.

In lib/strings/liquor-store.ts, copy the restaurant dictionary verbatim
as a stub. When Neat clones the repo, this file gets real liquor-specific
values. For now it exists so the resolver does not crash when
industry_type='liquor_store' is queried (which it will not be in
production, but defensive coding is cheap):

  import { restaurantStrings } from './restaurant';

  export const liquorStoreStrings = {
    ...restaurantStrings,
    // TODO: When Neat clones, replace with liquor-specific copy
  };

PART E — Resolver.

In lib/strings/index.ts:

  import type { StringKey, StringsDictionary } from './types';
  import { restaurantStrings } from './restaurant';
  import { liquorStoreStrings } from './liquor-store';

  const dictionaries: Record<string, StringsDictionary> = {
    restaurant: restaurantStrings,
    liquor_store: liquorStoreStrings,
  };

  export function getString(
    industryType: string | null | undefined,
    key: StringKey,
  ): string {
    const dict = dictionaries[industryType ?? 'restaurant'] ?? restaurantStrings;
    return dict[key] ?? key; // fall back to the key itself if missing
  }

  // Server components: pass industryType explicitly
  // Client components: use the hook below

  'use client';
  import { useVertical } from '@/lib/verticals';
  export function useStrings() {
    const vertical = useVertical(); // existing hook
    return (key: StringKey) => getString(vertical?.id, key);
  }

Note: Split the server-safe getString and the 'use client' hook into
separate files if the 'use client' directive causes import issues.
Typical split:
  lib/strings/index.ts       # server-safe: getString, types, dictionaries
  lib/strings/hooks.ts       # client-only: useStrings hook with 'use client'

PART F — Sweep and replace.

This is a manual, careful pass. Do NOT try to do it in one commit.
Break it into logical chunks:

Chunk 1: Onboarding wizard
Chunk 2: Dashboard home page (KPI cards, empty states)
Chunk 3: Competitors page
Chunk 4: Insights page (category labels, signal names)
Chunk 5: Content/menu intelligence page
Chunk 6: Photos, traffic, social, SEO pages
Chunk 7: Toast notifications (sonner calls)
Chunk 8: Email template subject lines and preview text

For each chunk:
1. Grep for likely hardcoded restaurant language:
   grep -rn "restaurant\|Restaurant\|menu\|Menu\|cuisine\|Cuisine\|dish" \
     app/ components/ --include="*.tsx" --include="*.ts"
2. Identify customer-facing string literals.
3. Add a StringKey for each one to types.ts.
4. Add the value to restaurant.ts.
5. Replace the literal in the component with getString(industryType, key)
   or useStrings()(key).
6. Commit.
7. Test the surface in dev.

Do NOT sweep types, interfaces, database column names, or internal
variable names. Only customer-visible strings.

PART G — Add a lint check.

Create a custom ESLint rule or a simple script at scripts/check-strings.ts
that grep-scans app/ and components/ for known restaurant-specific
words in JSX text content (not in comments, not in code). Fail CI if
new restaurant-specific hardcoded strings appear outside lib/strings/.

This is the guardrail that keeps the next dev from reintroducing
hardcoded restaurant language.
```

### 5.4 Verification checklist

- [ ] `lib/strings/` directory exists with types, restaurant, liquor-store, index, and hooks
- [ ] `getString()` resolver works in server components
- [ ] `useStrings()` hook works in client components
- [ ] Onboarding wizard uses `getString` / `useStrings` for all domain-facing copy
- [ ] Dashboard KPI cards use `getString` for section titles
- [ ] Competitors page uses `getString` for entity labels and empty states
- [ ] Toast notifications use `getString`
- [ ] Grep for restaurant-specific hardcoded JSX text in customer-facing routes returns zero hits (outside `lib/strings/restaurant.ts`)
- [ ] Pre-commit or CI check fails if a new hardcoded restaurant string appears outside `lib/strings/`
- [ ] Production build succeeds

### 5.5 Deferred to Neat clone

The `liquor-store.ts` file stays as a copy of `restaurant.ts` until the Neat repo clones from `vatic-core` and its own team fills in liquor-specific copy. That is correct. Do not populate liquor-specific strings in the Ticket codebase.

---

## 6. Workstream 5 — Wire Marketing Waitlist to Platform

**Goal:** When a user submits the contact form on `getticket.ai`, the submission lands in the Vatic app's `waitlist_signups` table, the admin gets notified, and Chris's Resend drip sequence fires. Platform-side confirmation email stays paused (from workstream 1).

**Why this is workstream 5:** It is the last step before Bryan can launch the `getticket.ai` marketing site publicly. It also closes the loop on Chris's Resend drip work — the drip cannot fire until waitlist rows are landing from the marketing site.

### 6.1 Architecture recap

```
User on getticket.ai
   │
   ▼
Submits contact form (name, email, business name, location, notes)
   │
   ▼
POST https://<ticket-production-url>/api/waitlist
   │   (CORS allowlist: getticket.ai, www.getticket.ai)
   ▼
Inserts row into waitlist_signups (industry_type='restaurant', status='pending')
   │
   ├─▶ Fires admin notification email to chris@alivelabs.io (internal, unblocked)
   │
   ├─▶ Resend webhook or Supabase trigger adds contact to Chris's Resend audience
   │
   └─▶ Platform-side waitlist-confirmation email is PAUSED (workstream 1)

Chris's Resend drip sequence fires against the Resend audience
   │
   ▼
Drip runs until admin approves the signup in /admin/waitlist
   │
   ▼
Admin approval fires the invitation email with magic link
(this email uses the override path from workstream 1)
```

### 6.2 Decision: Where does `getticket.ai` live?

Two options:

**Option A: Separate Vercel project, sibling folder in the same repo.** The VERTICALIZATION_V2 plan proposed `marketing/getticket/` as a sibling Next.js project. This gives Bryan a simple static marketing site he can edit without touching the app.

**Option B: Keep the landing page at `/` in the Vatic app, point `getticket.ai` at it via Vercel domain aliasing.** Simpler, no new Vercel project, but the app serves double-duty as marketing + product.

**Recommendation: Option A.** The April 16 meeting confirmed Bryan wants a static, dumb marketing site he can fork and edit without fear of breaking the app. The whole point of cloning per-vertical is separation. Start enforcing that separation now, at the marketing layer.

### 6.3 Cursor instructions

```
PART A — Scaffold the marketing/getticket/ sibling project.

From the root of the Vatic production repo:

  mkdir -p marketing/getticket
  cd marketing/getticket

  # Initialize a minimal Next.js 16 app
  npm init -y
  npm install next@16 react@19 react-dom@19
  npm install -D typescript@5 @types/react @types/node tailwindcss@4 \
    @tailwindcss/postcss autoprefixer

  # Create the basic structure
  mkdir -p app public components

Create marketing/getticket/app/layout.tsx with Ticket branding baked in
(favicon, metadata, Inter + Barlow Condensed fonts for the Ticket theme).

Create marketing/getticket/app/page.tsx by copying the current landing
page from the Vatic app at app/page.tsx, then stripping out:
- Any auth-aware logic (this site has no login)
- Any Supabase imports
- Any imports from @/lib/ that reference database or auth
Keep:
- All hero, feature, pricing, and trust counter sections
- The waitlist form UI

Update the waitlist form submit handler to POST to the Vatic app's
/api/waitlist endpoint (absolute URL):

  const WAITLIST_ENDPOINT =
    process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT ??
    'https://ticket.thevatic.ai/api/waitlist';  // <-- use actual prod URL

  async function onSubmit(data) {
    await fetch(WAITLIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, industry_type: 'restaurant' }),
    });
  }

Create marketing/getticket/next.config.ts, tailwind config (v4 CSS-based),
postcss config, and tsconfig.json. Mirror the Ticket app's Tailwind v4
setup so the design tokens match.

Create a vercel.json in marketing/getticket/ pinning the framework and
build settings. Vercel will use the "Root Directory" project setting to
know where to deploy from.

PART B — Update /api/waitlist in the Vatic app.

Open app/api/waitlist/route.ts.

Current behavior: Accepts waitlist submissions from the same-origin
landing page.

New behavior:
1. Accept cross-origin submissions from getticket.ai.
2. Require an industry_type in the payload.
3. Validate industry_type against the enum.
4. Use the Origin header to cross-check industry_type (getticket.ai can
   only submit industry_type='restaurant'). Reject mismatches.

Add CORS handling:

  const ALLOWED_ORIGINS = [
    'https://getticket.ai',
    'https://www.getticket.ai',
    'http://localhost:3000',  // for local dev of marketing site
    'http://localhost:3001',  // if marketing runs on a different port
  ];

  export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');
    const corsHeaders = origin && ALLOWED_ORIGINS.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : {};

    // ... existing logic, but:
    // 1. Validate industry_type from body
    // 2. Cross-check against Origin (getticket.ai → restaurant only)
    // 3. Insert waitlist_signups row with industry_type column
    // 4. Fire admin notification (unblocked, internal email)
    // 5. Do NOT fire client confirmation (gated by CLIENT_EMAILS_ENABLED)
    // 6. Return success with CORS headers
  }

PART C — Hook into Chris's Resend audience.

Chris is configuring Resend drip sequences. The drip fires against a
Resend "audience" (their term for a contact list).

Option 1 (simpler): Add the contact to the Resend audience via the
Resend SDK inside the /api/waitlist POST handler, fire-and-forget:

  // After successful waitlist_signups insert:
  void resend.contacts.create({
    audienceId: process.env.RESEND_WAITLIST_AUDIENCE_ID!,
    email: body.email,
    firstName: body.name?.split(' ')[0],
    lastName: body.name?.split(' ').slice(1).join(' '),
    unsubscribed: false,
  }).catch(err => console.error('[resend] failed to add to audience', err));

Option 2 (more decoupled): Create a Supabase database trigger or edge
function that fires on waitlist_signups INSERT and calls the Resend API.

Recommend Option 1 for now — simpler, easier to debug. Revisit if Chris
wants Resend logic decoupled from the app later.

Add RESEND_WAITLIST_AUDIENCE_ID to the env vars. Chris will provide the
audience ID from his Resend configuration.

PART D — Deploy marketing/getticket/ as its own Vercel project.

In the Vercel dashboard (manual step, not Cursor):

1. Add a new project from the same GitHub repo.
2. Set "Root Directory" to `marketing/getticket`.
3. Set environment variables:
   - NEXT_PUBLIC_WAITLIST_ENDPOINT=<actual Vatic production URL>/api/waitlist
4. Deploy.
5. Add custom domain getticket.ai and www.getticket.ai.
6. Set up DNS (CNAME to cname.vercel-dns.com, A record to 76.76.21.21
   or however Vercel recommends currently).
7. Wait for DNS propagation and SSL issuance.

PART E — End-to-end test.

1. Visit https://getticket.ai.
2. Submit the waitlist form with a test email.
3. Verify:
   - Row appears in waitlist_signups with industry_type='restaurant',
     status='pending'.
   - Admin notification email lands at chris@alivelabs.io.
   - No client confirmation email is sent (paused).
   - Contact appears in the Resend audience (check Resend dashboard).
4. From /admin/waitlist, approve the test signup.
5. Verify:
   - Auth user is created.
   - Organization is created with industry_type='restaurant', 14-day trial.
   - Invitation email (with magic link) lands at the test email.
   - Magic link logs the test user into the Ticket dashboard.

If any step fails, debug that step before proceeding.
```

### 6.4 Verification checklist

- [ ] `marketing/getticket/` exists as an independent Next.js 16 project
- [ ] `getticket.ai` serves the marketing site via its own Vercel project
- [ ] Waitlist form on `getticket.ai` POSTs to Vatic `/api/waitlist` with `industry_type='restaurant'`
- [ ] `/api/waitlist` accepts CORS requests from `getticket.ai` origins only
- [ ] `/api/waitlist` rejects requests with mismatched origin vs industry_type
- [ ] Waitlist row is created on submission
- [ ] Admin notification fires (internal email, not paused)
- [ ] Platform-side waitlist-confirmation email does NOT fire (paused)
- [ ] Contact is added to Chris's Resend audience for the drip sequence
- [ ] Admin approval flow creates the org + fires the invitation email (override path)
- [ ] Magic link from invitation email logs the user into the dashboard
- [ ] DNS propagation is complete, SSL is valid on `getticket.ai`

### 6.5 Rollback

If CORS or the cross-origin POST breaks, point `getticket.ai`'s waitlist form at a `mailto:chris@alivelabs.io` fallback while you debug. Bryan does not need the waitlist to be self-service — he needs it to work.

---

## 7. Parallel Workstream — Meeting Follow-Ups Not on the Critical Path

These items came out of the April 16 meeting but do not block the Ticket relaunch. Do them in parallel, as time permits, or when you are blocked on a workstream above.

### 7.1 Notion "Open Questions" section + daily ticket job

**Owner:** Bryan (he is building the section + ingestion flow).
**Anand dependency:** None. Bryan handles this end-to-end. Anand just needs to start using it — dumping questions into the section as they arise, either manually or via Claude.

### 7.2 Blog publishing workflow Claude skill

**Owner:** Anand (already built, owes the team).
**Action:** Share the skill file with Bryan and Chris via Slack or drop it into the Notion workspace. One-time action, 5 minutes.

### 7.3 Rebrand Alive Labs → (new name)

**Owner:** Anand.
**Status:** Separate project. Not blocked by and does not block Ticket work. Track as its own Notion ticket.

### 7.4 Update Resend config for marketing-side drip triggers

**Owner:** Chris.
**Anand dependency:** Workstream 5 must be done first (Resend audience integration in `/api/waitlist`). Once that ships, Chris can configure the drip sequences in Resend against the waitlist audience.

### 7.5 Review form integration approach

**Status:** Closed. Workstream 5 is the decision. Document it in Notion for Bryan's awareness.

---

## 8. Sequencing and Calendar Estimate

At a sustainable 5-7 hours per week, with occasional weekend pushes:

| Workstream | Effort | Calendar | Blocks |
|---|---|---|---|
| 1. Pause client emails | 0.5 days | Week 1 | Nothing |
| 2. Create vatic-core | 0.5 days | Week 1 | Nothing |
| 3. Rebrand to Ticket | 2-3 days | Weeks 1-2 | Nothing |
| 4. String variables | 2-3 days | Weeks 2-3 | Workstream 3 (rebrand surfaces the strings) |
| 5. Marketing waitlist | 2 days | Weeks 3-4 | Workstream 1 (email pause prevents collision) |

**Total:** 7-9 working days, roughly 4-5 calendar weeks.

**Recommended order:** 1 → 2 → 3 → 5 → 4. Save string externalization for last because it does not block anything downstream and it benefits from the natural sweep workstream 3 creates.

---

## 9. What Stays Untouched

These are the areas the April 16 meeting explicitly did not touch and that you should not touch during this phase:

- Component logic inside `/dashboard`, `/insights`, `/competitors`, `/onboarding` (other than string replacements)
- Database schema beyond what is already shipped
- Routing structure
- Authentication flow
- RLS policies
- Supabase edge functions
- Insight generation rules
- Data provider integrations (DataForSEO, Firecrawl, Data365, Outscraper, OpenWeatherMap)
- The `VERTICALIZATION_ENABLED` flag (stays `false` in production)
- Stripe configuration
- Admin dashboard at `/admin/*`
- `lib/verticals/` directory (the config layer stays intact)

---

## 10. Open Questions to Confirm with Bryan and Chris

Track these in Notion under the new open-questions section Bryan is creating.

1. **From-address for the admin notification email.** Currently references a possibly incorrect address (per BLUEPRINT.md it goes to `chris@alivelabs.io`, but the meeting hinted at ambiguity). Confirm the correct internal-notification destination.

2. **Ticket favicon + apple-touch-icon assets.** Workstream 3 uses placeholders if Bryan has not shipped final Ticket brand assets. Bryan needs to deliver these.

3. **Ticket final wordmark and logo SVG.** Same as above.

4. **Resend audience ID for Ticket waitlist.** Chris needs to provide `RESEND_WAITLIST_AUDIENCE_ID` from his Resend configuration once the audience exists.

5. **DNS authority for getticket.ai.** Who owns the domain registration and can add the Vercel verification TXT records. Bryan probably; confirm.

6. **Waitlist approval cadence.** Daily? Weekly? On-demand? This affects how aggressively Chris's drip sequence paces the pre-approval emails.

7. **When does the post-approval welcome email fire, and who owns its content?** Platform sends the invitation-with-magic-link on approval. Is that the welcome, or is there a separate welcome that fires after first login? Chris likely owns the copy either way.

8. **Plan for `thevatic.ai` platform marketing site.** Out of scope for this PRD but tracked as the parent of all future vertical launches.

---

## 11. Done Criteria for This Phase

The Ticket relaunch is done when:

- [ ] A new user on `getticket.ai` can submit the waitlist form
- [ ] Their submission creates a pending `waitlist_signups` row with `industry_type='restaurant'`
- [ ] An admin notification email lands at the internal address
- [ ] Chris's Resend drip sequence starts firing against the contact
- [ ] The admin can approve them from `/admin/waitlist`
- [ ] Approval creates the auth user, organization, 14-day trial, and sends the invitation email with magic link
- [ ] The invitation recipient can click the magic link, log in, and see a fully Ticket-branded dashboard
- [ ] Throughout the flow, no Vatic branding appears in any customer-facing surface
- [ ] Browser tab title, favicon, and meta tags read Ticket everywhere
- [ ] `vatic-core` repo exists with the anti-modification guard in place
- [ ] Domain-specific language can be changed by editing `lib/strings/restaurant.ts` without touching any component
- [ ] Client-facing platform emails are paused via `CLIENT_EMAILS_ENABLED=false`

When all eleven boxes are checked, Ticket is ready for a public beta launch and Neat can begin its clone from `vatic-core`.

---

## Appendix A — How to Feed This PRD to Cursor

This document is written to be consumed by Cursor in sections. Recommended workflow:

1. Open Cursor with the Vatic production repo as the workspace.
2. Open this PRD in a side panel or external editor.
3. For each workstream, copy the **Cursor instructions** block (the fenced code block labeled `PART A / PART B / ...`) into Cursor's composer.
4. Run one PART at a time. Verify the build after each PART. Commit after each PART.
5. Do not feed Cursor the entire PRD at once. It will try to do everything and you will lose track of what changed.

Recommended Cursor rules to add to `.cursorrules` at the root of the Ticket repo:

```
This is the Ticket production codebase. It is a fork of vatic-core,
customized for the restaurant vertical. Do not:
- Modify files inside lib/verticals/ without explicit confirmation
- Change VERTICALIZATION_ENABLED env var default (must stay false in prod)
- Delete or rename neat-theme.css, liquor-store config, or any
  multi-vertical machinery
- Touch anything in vatic-core
- Modify database schema without an additive migration
- Delete email templates (only gate them with CLIENT_EMAILS_ENABLED)

When in doubt, ask. When modifying customer-facing strings, check
lib/strings/restaurant.ts first — the string may already be externalized.
```

Add this file before starting any workstream.

---

## Appendix B — Historical Context

For future you, or for the next developer, the shortest possible version of how we got here:

- **January 2026:** Prophet PRD v0.1 scoped as portal-first competitive intelligence for restaurants. Single vertical. Single domain.
- **February-March 2026:** Product shipped through Phases 1-10 of the initial roadmap. Restaurant-first. Generic Vatic branding.
- **April 7, 2026:** VERTICALIZATION_PRD v1 recommended single codebase with subdomain routing for multi-vertical expansion.
- **April 11, 2026:** BLUEPRINT.md captured the verticalization machinery as shipped — `lib/verticals/`, `data-brand` theming, `BrandProvider`, `useChartColors`. `VERTICALIZATION_ENABLED` flag default off.
- **April 12, 2026:** VERTICALIZATION_V2.md locked single-codebase + subdomain routing approach.
- **April 16, 2026:** Product call reversed the single-codebase decision in favor of clone-per-vertical. Preserved the theming work. This PRD captures that reversal.
- **April 17, 2026:** This document. Ticket relaunch sequenced for the following 4-5 calendar weeks.

---

**End of PRD.**
