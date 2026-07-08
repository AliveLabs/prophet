// Authed route-smoke suite (ALT-244).
//
// Closes the gap the Weather/Admin RSC-boundary incidents exposed (commit 046c460): tsc, next
// build, and the static lint:rsc-boundary guard all catch KNOWN shapes of server/client
// boundary mistakes, but none of them actually render a route. This suite loads every
// (dashboard) and /admin route with a real seeded session and fails the build if:
//   1. the response status is not 200 (or an expected redirect for a route that legitimately
//      needs a seeded entity that doesn't exist in the CI org, e.g. /competitors/[id]),
//   2. the rendered DOM is the app/error.tsx error boundary ("That didn't go through." /
//      .chrome-card), which means the route threw at request time, or
//   3. the browser console logged a React hydration-mismatch error.
//
// Uses the "authed" storageState produced by auth.setup.ts (real Supabase session, not a
// bypass) — see tests/e2e/auth.setup.ts and scripts/ci/seed-e2e-user.mts for how that's minted.

import { test, expect, type Page } from "@playwright/test"

// Static (no dynamic segment) routes under app/(dashboard) — reachable from the seeded org's
// "current org" with no further setup.
const DASHBOARD_ROUTES = [
  "/home",
  "/home/pool",
  "/ask",
  "/competitors",
  "/content",
  "/events",
  "/insights",
  "/locations",
  "/locations/new",
  "/photos",
  "/settings",
  "/settings/billing",
  "/settings/organization",
  "/settings/team",
  "/social",
  "/traffic",
  "/visibility",
  "/weather",
]

// Static admin routes.
const ADMIN_ROUTES = [
  "/admin",
  "/admin/health",
  "/admin/knowledge-review",
  "/admin/maintenance",
  "/admin/organizations",
  "/admin/sandbox",
  "/admin/settings",
  "/admin/source-quality",
  "/admin/users",
  "/admin/waitlist",
  "/admin/organizations/new",
]

// Dynamic-segment routes: the seeded CI org has no competitors/plays yet, so these are
// expected to 404 cleanly (notFound()) rather than 200 — that's still a meaningful assertion
// (a 500 / thrown error / error-boundary render here would mean the [id]/[rank] loader isn't
// handling "missing" safely). If the CI seed is later extended to include a competitor/play,
// tighten these to assert 200 instead.
const DYNAMIC_ROUTES_EXPECT_404 = [
  "/competitors/00000000-0000-0000-0000-000000000000",
  "/home/1",
  "/admin/organizations/00000000-0000-0000-0000-000000000000",
  "/admin/users/00000000-0000-0000-0000-000000000000",
]

const HYDRATION_ERROR_PATTERNS = [
  /hydration failed/i,
  /did not match/i,
  /text content does not match/i,
  /hydrating but some attributes/i,
  /error while hydrating/i,
]

async function assertNoErrorBoundary(page: Page, path: string) {
  // app/error.tsx renders this exact copy — see app/error.tsx (read-only reference, not edited
  // by this change).
  await expect(
    page.getByRole("heading", { name: /That didn.t go through/i }),
    `${path} rendered the app/error.tsx error boundary`
  ).toHaveCount(0)
  await expect(page.locator(".chrome-card"), `${path} rendered the error-boundary chrome-card`).toHaveCount(0)
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(err.message))
  return errors
}

function assertNoHydrationErrors(errors: string[], path: string) {
  const hydrationErrors = errors.filter((e) => HYDRATION_ERROR_PATTERNS.some((p) => p.test(e)))
  expect(hydrationErrors, `${path} logged hydration error(s):\n${hydrationErrors.join("\n")}`).toHaveLength(0)
}

test.describe("dashboard route smoke", () => {
  for (const path of DASHBOARD_ROUTES) {
    test(`GET ${path} renders without a runtime error`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page)
      const response = await page.goto(path)

      expect(response, `${path} returned no response`).not.toBeNull()
      expect(response!.status(), `${path} returned ${response!.status()}`).toBeLessThan(400)

      await assertNoErrorBoundary(page, path)
      assertNoHydrationErrors(consoleErrors, path)
    })
  }
})

test.describe("admin route smoke", () => {
  for (const path of ADMIN_ROUTES) {
    test(`GET ${path} renders without a runtime error`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page)
      const response = await page.goto(path)

      expect(response, `${path} returned no response`).not.toBeNull()
      expect(response!.status(), `${path} returned ${response!.status()}`).toBeLessThan(400)

      await assertNoErrorBoundary(page, path)
      assertNoHydrationErrors(consoleErrors, path)
    })
  }
})

test.describe("dynamic route smoke (missing entity -> clean 404, not a crash)", () => {
  for (const path of DYNAMIC_ROUTES_EXPECT_404) {
    test(`GET ${path} 404s cleanly instead of throwing`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page)
      const response = await page.goto(path)

      expect(response, `${path} returned no response`).not.toBeNull()
      // Next's notFound() renders the route's not-found boundary with a 404 status. Anything
      // >= 500 means the loader threw instead of handling "missing" safely.
      expect(response!.status(), `${path} returned ${response!.status()}`).toBeLessThan(500)

      await assertNoErrorBoundary(page, path)
      assertNoHydrationErrors(consoleErrors, path)
    })
  }
})
