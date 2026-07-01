import { defineConfig, devices } from "@playwright/test"

const shouldStartServer = process.env.PLAYWRIGHT_START_SERVER === "true"
// CI builds + starts the real production server so route-smoke exercises the same server
// output that ships to prod; local runs default to `next dev` for fast iteration.
const isCI = !!process.env.CI
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000"

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: shouldStartServer
    ? {
        command: isCI
          ? "npm run start -- --hostname 127.0.0.1 --port 3000"
          : "npm run dev -- --hostname 127.0.0.1 --port 3000",
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 60_000,
      }
    : undefined,
  projects: [
    // Top-level smoke specs (auth-onboarding.spec.ts, social.spec.ts) — unauthenticated.
    {
      name: "smoke",
      testMatch: /^(?!.*\/e2e\/).*\.spec\.ts$/,
    },
    // ALT-244 authed route-smoke suite. "setup" mints the real seeded session once; the
    // "e2e" project depends on it and reuses the resulting storageState for every route test.
    {
      name: "setup",
      testMatch: /e2e\/auth\.setup\.ts/,
    },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/e2e-user.json",
      },
    },
  ],
})
