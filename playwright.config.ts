import { defineConfig } from "@playwright/test"

const shouldStartServer = process.env.PLAYWRIGHT_START_SERVER === "true"

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: shouldStartServer
    ? {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
      }
    : undefined,
})
