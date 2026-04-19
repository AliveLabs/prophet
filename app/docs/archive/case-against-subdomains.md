# The Case Against Subdomain Routing

**Author:** Anand Iyer  
**Date:** April 14, 2026  
**Status:** Decision Document  
**Context:** Evaluating whether `ticket.thevatic.com` / `neat.thevatic.com` subdomain routing should proceed, or whether the platform should launch Neat using `org.industry_type` without changing the domain architecture.

---

## Executive Summary

Subdomain routing (`ticket.thevatic.com` and `neat.thevatic.com`) was proposed as Phase 3 of the verticalization roadmap. After a full audit of every system that depends on the current hostname, **the recommendation is to defer subdomain routing indefinitely** and launch Neat on the existing domain using the `organizations.industry_type` column as the sole vertical resolution mechanism.

The middleware file itself (~40 lines) is trivial and safe. But it is useless without also modifying **13 files across 6 subsystems** that hardcode a single hostname via `NEXT_PUBLIC_APP_URL`. Those modifications touch Google OAuth, Supabase magic links, Stripe checkout, cookie scoping, cron internals, and transactional emails — the most fragile parts of the application. The risk-to-reward ratio is not justified for launch.

---

## 1. What Subdomain Routing Actually Requires

The subdomain routing PRD describes a single `middleware.ts` file that reads the `Host` header and injects `x-vatic-industry-type` as a request header. That file is genuinely harmless in isolation. The problem is that **the middleware only becomes useful when two subdomains actually exist**, and the moment two subdomains exist, the following systems break.

---

## 2. System-by-System Breakdown of What Breaks

### 2.1 Google OAuth — Breaks Immediately

**File:** `app/(auth)/login/actions.ts`, lines 9-11, 62-71

```typescript
function getRedirectUrl() {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback`
}

export async function signInWithGoogleAction() {
  const redirectUrl = getRedirectUrl()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
    },
  })
```

**What happens:**
- `NEXT_PUBLIC_APP_URL` is a single value (currently `http://localhost:3000`, in production it would be one hostname).
- A user on `neat.thevatic.com` clicks "Sign in with Google."
- The `redirectTo` in the OAuth request points to `ticket.thevatic.com/auth/callback` (or whichever single value is in the env var).
- Google redirects the user to Supabase, which redirects to `ticket.thevatic.com/auth/callback`.
- The user lands on **the wrong vertical's domain**.
- Worse: if the cookie was set by `neat.thevatic.com` during the login page load, the auth callback on `ticket.thevatic.com` cannot read that cookie. The session exchange may fail silently.

**What would need to change:**
1. `getRedirectUrl()` must become hostname-aware, reading from `headers()` or the middleware-injected `x-vatic-hostname` header.
2. Google Cloud Console > OAuth 2.0 Client > Authorized Redirect URIs must list both `ticket.thevatic.com/auth/callback` AND `neat.thevatic.com/auth/callback`.
3. Supabase Dashboard > Authentication > URL Configuration > Redirect URLs must list both subdomains.
4. Supabase Dashboard > Authentication > URL Configuration > Site URL must be updated (it currently points to one URL).

**Risk if done wrong:** Users cannot log in. This is a complete authentication failure, not a cosmetic issue.

---

### 2.2 Magic Links — All 7 Generation Sites Point to Wrong Domain

Magic links are generated in **7 different locations** across the codebase, and every single one uses `NEXT_PUBLIC_APP_URL` to build the `redirectTo` URL.

| # | File | Line | Context |
|---|------|------|---------|
| 1 | `app/(auth)/login/actions.ts` | 10 | User-initiated magic link from login page |
| 2 | `app/actions/waitlist.ts` | 134-135 | Admin approves waitlist signup, sends invitation |
| 3 | `app/actions/waitlist.ts` | 268-272 | Admin resends invitation to approved signup |
| 4 | `app/actions/user-management.ts` | 96-100 | Admin invites new user directly |
| 5 | `app/actions/user-management.ts` | 236-240 | Admin sends magic link to existing user |
| 6 | `app/actions/user-management.ts` | 287-291 | Admin impersonates user via magic link |
| 7 | `app/actions/admin-management.ts` | 60-64 | Admin invites new platform admin |

**What happens:** Every magic link generated for a Neat user points to `ticket.thevatic.com/auth/callback` (or vice versa). The user clicks the link, lands on the wrong subdomain, and either:
- Gets logged in but with wrong-vertical branding (confusing).
- Fails to exchange the session because the cookie domain doesn't match (broken).

**What would need to change:** All 7 sites must resolve the correct hostname based on the target user's org `industry_type` (or, for pre-org users like waitlist signups, the waitlist row's `industry_type`). This is not a find-and-replace — each site has different context for resolving the vertical.

---

### 2.3 Auth Callback — Redirect Uses `request.url` Origin

**File:** `app/auth/callback/route.ts`, lines 37, 47

```typescript
return NextResponse.redirect(new URL("/login", request.url))
// and
return NextResponse.redirect(new URL(redirectPath, request.url))
```

This is actually one of the few pieces that would work correctly with subdomains, because `new URL(path, request.url)` preserves the incoming hostname. If a user arrives at `neat.thevatic.com/auth/callback`, the redirect goes to `neat.thevatic.com/home`.

**However**, this only works if the user actually arrives on the correct subdomain in the first place — which they won't, because of the `getRedirectUrl()` problem described above.

---

### 2.4 Supabase Cookie Scoping — Sessions Don't Cross Subdomains

**File:** `lib/supabase/server.ts`, lines 4-32

```typescript
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name) { return cookieStore.get(name)?.value },
        set(name, value, options) {
          try { cookieStore.set({ name, value, ...options }) } catch {}
        },
        remove(name, options) {
          try { cookieStore.set({ name, value: "", ...options }) } catch {}
        },
      },
    }
  )
}
```

**What happens:**
- The `@supabase/ssr` cookie adapter does not set an explicit `Domain` attribute.
- Without an explicit `Domain`, browsers default to the **exact hostname** that set the cookie.
- A cookie set by `ticket.thevatic.com` is **invisible** to `neat.thevatic.com`. They are different hostnames.
- This means a user logged into Ticket appears completely logged out if they visit Neat. There is no session sharing.

**For the current use case** (restaurant users stay on Ticket, liquor users stay on Neat), this is functionally acceptable — nobody should be crossing subdomains. But it means:
1. An admin who manages both verticals cannot stay logged in across both.
2. The V2 PRD's future vision of "one user owns orgs in both verticals" is impossible without fixing cookie scoping.
3. Any accidental navigation to the wrong subdomain (typo, bookmark, shared link) results in a logged-out experience.

**What would need to change:** The `cookieOptions` in `createServerSupabaseClient()` must explicitly set `domain: '.thevatic.com'` (with leading dot for subdomain sharing). This is a one-line change but it affects every single authenticated request in the application and must be tested exhaustively.

---

### 2.5 Stripe Checkout — Success/Cancel URLs Go to Wrong Domain

**File:** `app/api/stripe/checkout/route.ts`, lines 81-88

```typescript
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const session = await stripe.checkout.sessions.create({
  // ...
  success_url: `${appUrl}/settings/billing?upgraded=true`,
  cancel_url: `${appUrl}/settings/billing`,
```

**What happens:** A Neat user on `neat.thevatic.com` clicks "Upgrade," completes Stripe checkout, and is returned to `ticket.thevatic.com/settings/billing`. Their cookie is scoped to `neat.thevatic.com`, so the Ticket domain treats them as unauthenticated. The "upgrade successful" experience breaks.

**What would need to change:** Read the current org's `industry_type`, look up the correct hostname from the vertical config, and build the success/cancel URLs dynamically.

---

### 2.6 Trial Reminder Emails — Upgrade Links Go to Wrong Domain

**File:** `app/api/cron/trial-reminders/route.ts`, lines 63-65

```typescript
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const upgradeUrl = `${appUrl}/settings/billing`
```

**What happens:** A Neat org owner receives "Your trial is expiring" with a link to `ticket.thevatic.com/settings/billing`. They click it, land on Ticket's domain, appear logged out (cookie scoping), and cannot upgrade. Critical revenue path broken.

**What would need to change:** The cron must look up each org's `industry_type` and resolve the correct app hostname for the email's CTA link.

---

### 2.7 Welcome Email — Dashboard Link Goes to Wrong Domain

**File:** `app/onboarding/actions.ts`, lines 818, 829

```typescript
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
// ...
dashboardUrl: `${appUrl}/home`,
```

**What happens:** A new Neat user completes onboarding and receives "Welcome to Vatic" with a dashboard link pointing to `ticket.thevatic.com/home`.

---

### 2.8 Waitlist Admin Notification — Admin Link Goes to Wrong Domain

**File:** `app/api/waitlist/route.ts`, lines 120, 128

```typescript
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
// ...
adminDashboardUrl: `${appUrl}/admin/waitlist`,
```

Less critical (admin-facing), but still wrong if the admin is on a different hostname.

---

### 2.9 Daily Cron Internal Fetch — Potentially Fragile

**File:** `app/api/cron/daily/route.ts`, lines 108-110

```typescript
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000"
```

This builds an internal URL for the `fetch` call to `/api/jobs/refresh_all`. The middleware would inject `x-vatic-industry-type: restaurant` (the default for unknown hosts), which is harmless for job routing. **This one is actually fine**, but it's a place where future hostname changes could create unexpected behavior.

---

### 2.10 Competitor Discovery — Internal API Fetch

**File:** `app/(dashboard)/competitors/actions.ts`, lines 77-78

```typescript
const response = await fetch(
  `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/places/details?place_id=...`
)
```

This is a server-side fetch to the app's own API. It uses `NEXT_PUBLIC_APP_URL` to build the URL. With subdomains, the request would go to whichever hostname is in the env var, which works but adds unnecessary network hops if the URL doesn't match the deployment.

---

## 3. Total Scope of Changes Required for Subdomains

| Subsystem | Files to Modify | Risk Level | Testability |
|-----------|:---:|:---:|---|
| Google OAuth redirect | 1 file + Google Console + Supabase Dashboard | Critical | Manual only (requires real OAuth flow) |
| Magic link generation | 5 files, 7 call sites | Critical | Manual only (requires real email delivery) |
| Cookie domain scoping | 1 file (affects entire auth system) | Critical | Requires multi-hostname local testing |
| Stripe checkout URLs | 1 file | High | Requires Stripe test mode |
| Trial reminder emails | 1 file | Medium | Cron must be triggered manually |
| Welcome/admin emails | 2 files | Low | Can test with Resend |
| Internal API fetches | 2 files | Low | Standard integration testing |
| Supabase Dashboard config | N/A (manual) | Critical | Must verify on production Supabase |
| Google Cloud Console config | N/A (manual) | Critical | Must verify with real Google OAuth |
| DNS configuration | N/A (infrastructure) | Medium | TTL propagation delays |
| Vercel domain configuration | N/A (infrastructure) | Low | Standard Vercel workflow |

**Total: 13 code files + 3 external service configurations + 2 infrastructure changes.**

---

## 4. What We Already Have That Makes Subdomains Unnecessary

The verticalization work completed in Phase 1-2 already provides a robust mechanism for vertical resolution **without subdomains**:

### 4.1 Database-Level Resolution (Authenticated Users)

Every org has `organizations.industry_type` (`'restaurant'` or `'liquor_store'`). The dashboard layout (`app/(dashboard)/layout.tsx`) already loads the org. Adding `industry_type` to that query gives every dashboard page access to the vertical — no hostname needed.

### 4.2 Query Parameter Resolution (Unauthenticated Flows)

The onboarding page already supports `?vertical=liquor_store`:

```typescript
// app/onboarding/page.tsx, lines 12-13
const params = await searchParams
const verticalParam = typeof params.vertical === "string" ? params.vertical : undefined
const verticalConfig = getVerticalConfig(verticalParam)
```

This same pattern can be extended to login and signup pages.

### 4.3 Config Layer Already Built

`lib/verticals/` already contains complete configs for both restaurant and liquor store verticals, with all labels, categories, onboarding copy, email copy, and AI prompt context. Every consumer just calls `getVerticalConfig(industryType)`.

### 4.4 Feature Flag Already Works

`VERTICALIZATION_ENABLED=false` keeps all vertical-aware behavior dormant until explicitly activated. This is a safer gate than DNS/hostname routing.

---

## 5. The Alternative: Single-Domain Vertical Resolution

Instead of subdomains, resolve the vertical from `org.industry_type` (authenticated) or `?vertical=` query param (unauthenticated). This requires:

### What Changes

| Change | Effort | Risk |
|--------|--------|------|
| Dashboard layout reads `industry_type` from org, passes to `VerticalProvider` | ~30 minutes | Minimal — additive, no existing behavior changes |
| Login/signup pages accept `?vertical=` for branding | ~1 hour | Minimal — purely cosmetic, falls back to default |
| Onboarding already handles `?vertical=` | Already done | Zero |
| Email templates already accept vertical copy | Already done | Zero |

### What Stays the Same

- `NEXT_PUBLIC_APP_URL` remains a single value. Zero auth changes.
- Google OAuth continues working exactly as-is. Zero Google Console changes.
- Supabase auth configuration unchanged. Zero Supabase Dashboard changes.
- Cookie scoping unchanged. Zero session risks.
- Stripe checkout URLs unchanged. Zero billing risks.
- Magic links unchanged. Zero email delivery risks.
- Cron jobs unchanged. Zero infrastructure risks.
- DNS unchanged. Zero propagation risks.

### What Users See

| Surface | Subdomain Approach | Single-Domain Approach |
|---------|-------------------|----------------------|
| URL bar | `ticket.thevatic.com/home` | `thevatic.com/home` |
| Login page | Ticket or Neat branding based on hostname | Ticket or Neat branding based on `?vertical=` or org context |
| Dashboard | Branded via middleware header | Branded via `org.industry_type` |
| Emails | Links to vertical-specific subdomain | Links to same domain (works regardless) |
| Onboarding | Hostname determines vertical | `?vertical=` parameter determines vertical |

The **only** user-visible difference is the URL bar. Everything else — the branding, the copy, the categories, the AI prompts, the email templates — works identically in both approaches.

---

## 6. When Subdomains Might Make Sense

Subdomains become worth the cost when:

1. **Brand separation is critical for customer trust.** If Ticket and Neat customers would be confused or distrustful seeing a shared URL, subdomains provide psychological separation. This is a marketing/brand decision, not a technical one.

2. **You have more than 2 verticals.** At 5+ verticals, the `?vertical=` approach starts to feel hacky for unauthenticated flows. Subdomains provide clean per-vertical entry points.

3. **You need cross-subdomain SSO.** If a user owns both a restaurant and a liquor store, cookie-scoped sessions on a shared parent domain (`.thevatic.com`) enable seamless switching.

4. **All downstream systems have been made hostname-aware.** This is the technical prerequisite. Until then, subdomains create more problems than they solve.

**None of these conditions are true today.** Condition 1 might be true at launch, but that's a decision for Bryan and Chris, not a technical requirement. Conditions 2-4 are future concerns.

---

## 7. Recommendation

**Defer subdomain routing. Launch Neat on the existing domain using `org.industry_type`.**

This recommendation is based on:

1. **13 files and 3 external services must be modified** to support subdomains safely. The changes touch Google OAuth, Supabase magic links, Stripe checkout, cookie scoping, cron jobs, and transactional emails — the most fragile, hardest-to-test parts of the application.

2. **The `middleware.ts` file alone does nothing.** It injects a header that no code reads. Without the downstream changes, it is inert infrastructure.

3. **Everything needed for Neat already works without subdomains.** The `industry_type` column, the vertical config layer, the feature flag, and the query parameter approach are all built and tested.

4. **The subdomain migration can be done later as a standalone project.** It's purely additive — adding subdomains later doesn't require undoing any of the single-domain work. But doing it now means accepting risk on the most fragile systems for a benefit that amounts to a different URL in the browser's address bar.

5. **Time to launch matters more than URL aesthetics.** Every hour spent on subdomain plumbing is an hour not spent on Phase 5 (dashboard chrome), Phase 6 (email branding), or Phase 10 (Neat launch).

---

## 8. If We Do Subdomains Later: Prerequisites Checklist

When the time comes (after Neat launch, after both verticals are stable), here is the exact work required:

- [ ] Create `middleware.ts` (the PRD's ~40 lines — this part is trivial)
- [ ] Create `lib/verticals/request-context.ts` with `getVerticalFromRequest()` helper
- [ ] Refactor `getRedirectUrl()` in `app/(auth)/login/actions.ts` to read hostname from `headers()`
- [ ] Update all 7 magic link generation sites to resolve hostname from org/waitlist `industry_type`
- [ ] Add `domain: '.thevatic.com'` to `cookieOptions` in `lib/supabase/server.ts` (and test exhaustively)
- [ ] Update Stripe checkout success/cancel URLs to use org-aware hostname
- [ ] Update trial reminder cron to resolve per-org hostname for email links
- [ ] Update welcome email to use org-aware hostname
- [ ] Add both subdomains to Google Cloud Console > OAuth > Authorized Redirect URIs
- [ ] Add both subdomains to Supabase Dashboard > Auth > Redirect URLs
- [ ] Update Supabase Dashboard > Auth > Site URL
- [ ] Configure DNS: `ticket.thevatic.com` CNAME to Vercel, `neat.thevatic.com` CNAME to Vercel
- [ ] Add both domains to Vercel project settings
- [ ] Full end-to-end test: Google OAuth on both subdomains
- [ ] Full end-to-end test: magic link login on both subdomains
- [ ] Full end-to-end test: Stripe checkout on both subdomains
- [ ] Full end-to-end test: cron-triggered emails with correct links

**Estimated effort when done as a dedicated project:** 3-4 focused days, including testing.

---

*This document recommends a path-of-least-risk approach. The technical architecture supports subdomains whenever the business need justifies the migration cost. That day is not today.*
