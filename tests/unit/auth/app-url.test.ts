// ALT-442: getAppOrigin must return the deployment actually serving the request on Vercel
// preview (not the canonical prod URL), or Google/magic-link login never returns to the
// preview. Production still uses the canonical URL; local falls back to localhost. These
// cases pin the per-environment branching so a future refactor can't silently re-break preview.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { getAppOrigin, getAuthCallbackUrl } from "@/lib/auth/app-url"

const ENV_KEYS = [
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "NEXT_PUBLIC_APP_URL",
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("getAppOrigin", () => {
  it("uses the canonical NEXT_PUBLIC_APP_URL in production", () => {
    process.env.VERCEL_ENV = "production"
    process.env.NEXT_PUBLIC_APP_URL = "https://app.getticket.ai"
    process.env.VERCEL_URL = "prophet-abc123-alive-labs.vercel.app"
    expect(getAppOrigin()).toBe("https://app.getticket.ai")
  })

  it("strips a trailing slash from the canonical URL", () => {
    process.env.VERCEL_ENV = "production"
    process.env.NEXT_PUBLIC_APP_URL = "https://app.getticket.ai/"
    expect(getAppOrigin()).toBe("https://app.getticket.ai")
  })

  it("falls back to the deploy URL in production when the canonical var is unset", () => {
    process.env.VERCEL_ENV = "production"
    process.env.VERCEL_URL = "prophet-prod-alive-labs.vercel.app"
    expect(getAppOrigin()).toBe("https://prophet-prod-alive-labs.vercel.app")
  })

  it("returns THIS preview's branch alias, not the canonical prod URL", () => {
    process.env.VERCEL_ENV = "preview"
    process.env.NEXT_PUBLIC_APP_URL = "https://app.getticket.ai"
    process.env.VERCEL_BRANCH_URL = "prophet-git-fix-alt-442-alive-labs.vercel.app"
    process.env.VERCEL_URL = "prophet-hash9-alive-labs.vercel.app"
    expect(getAppOrigin()).toBe("https://prophet-git-fix-alt-442-alive-labs.vercel.app")
  })

  it("prefers the branch alias but falls back to the per-deploy URL on preview", () => {
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_URL = "prophet-hash9-alive-labs.vercel.app"
    expect(getAppOrigin()).toBe("https://prophet-hash9-alive-labs.vercel.app")
  })

  it("uses NEXT_PUBLIC_APP_URL locally when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"
    expect(getAppOrigin()).toBe("http://localhost:3000")
  })

  it("defaults to localhost when nothing is set", () => {
    expect(getAppOrigin()).toBe("http://localhost:3000")
  })
})

describe("getAuthCallbackUrl", () => {
  it("appends /auth/callback to the resolved origin", () => {
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_BRANCH_URL = "prophet-git-x-alive-labs.vercel.app"
    expect(getAuthCallbackUrl()).toBe(
      "https://prophet-git-x-alive-labs.vercel.app/auth/callback"
    )
  })
})
