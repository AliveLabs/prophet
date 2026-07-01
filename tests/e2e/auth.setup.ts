// Playwright "setup" project (ALT-244) — mints a REAL authed session for the route-smoke
// suite by running scripts/ci/seed-e2e-user.mts (CI-only Supabase project, see that file's
// header for the safety argument) and then driving an actual browser through the magic-link
// action_link Supabase's admin API returns. That link round-trips through the app's existing
// /auth/callback route (unmodified — just like a real user clicking a real email), so this
// exercises the production auth code path rather than bypassing it.
//
// Requires CI_SUPABASE_URL / CI_SUPABASE_SERVICE_ROLE_KEY to be set (see ci.yml — the
// route-smoke job is skipped entirely when they're absent, e.g. forks/contributors).

import { test as setup } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const STORAGE_STATE_PATH = path.join(process.cwd(), "tests/e2e/.auth/e2e-user.json")
const SEED_OUTPUT_PATH = process.env.E2E_SEED_OUTPUT ?? "/tmp/e2e-seed.json"

setup("seed CI test org/user and mint a real session", async ({ page, baseURL }) => {
  if (!process.env.CI_SUPABASE_URL || !process.env.CI_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "auth.setup: CI_SUPABASE_URL / CI_SUPABASE_SERVICE_ROLE_KEY are required to run the route-smoke suite locally. " +
        "See scripts/ci/seed-e2e-user.mts."
    )
  }

  execFileSync("npx", ["tsx", "scripts/ci/seed-e2e-user.mts"], {
    stdio: "inherit",
    env: { ...process.env, E2E_APP_URL: baseURL ?? "http://127.0.0.1:3000" },
  })

  if (!existsSync(SEED_OUTPUT_PATH)) {
    throw new Error(`auth.setup: seed output not found at ${SEED_OUTPUT_PATH}`)
  }
  const seed = JSON.parse(readFileSync(SEED_OUTPUT_PATH, "utf-8")) as { actionLink: string }

  // Navigate the real browser through Supabase's verify endpoint -> app's /auth/callback,
  // which sets the real session cookies via exchangeCodeForSession. Land on /home confirms
  // a genuine authed session (not just "cookie present").
  await page.goto(seed.actionLink)
  await page.waitForURL(/\/(home|onboarding)/, { timeout: 15_000 })

  await page.context().storageState({ path: STORAGE_STATE_PATH })
})
