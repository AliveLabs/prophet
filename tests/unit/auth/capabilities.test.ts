// Phase 6a — platform-admin role/capability matrix. Security-critical: a regression here
// silently grants or revokes admin power, so the expected matrix is pinned explicitly below
// and any change to lib/auth/capabilities.ts must be mirrored here on purpose.

import { describe, it, expect } from "vitest"
import {
  ADMIN_ROLES,
  ROLE_RANK,
  CAPABILITY_MIN_ROLE,
  type AdminRole,
  type Capability,
  hasRole,
  roleHasCapability,
  normalizeRole,
  isValidRole,
  CapabilityError,
} from "@/lib/auth/capabilities"

// The intended matrix, written out independently of the implementation. If this and
// CAPABILITY_MIN_ROLE ever disagree, that's a bug (or an undocumented policy change).
const EXPECTED_MIN_ROLE: Record<Capability, AdminRole> = {
  view: "read_only",
  export: "read_only",
  "waitlist.manage": "admin",
  "user.manage": "admin",
  "user.impersonate": "admin",
  "org.manage": "admin",
  "org.delete": "admin",
  "demo.manage": "admin",
  "email.send": "admin",
  "billing.convert": "super_admin",
  "user.delete": "super_admin",
  "admin.manage": "super_admin",
  "knowledge.manage": "super_admin",
  "source_quality.manage": "admin",
}

const ALL_CAPABILITIES = Object.keys(CAPABILITY_MIN_ROLE) as Capability[]

describe("capability matrix", () => {
  it("matches the intended min-role for every capability (pinned)", () => {
    expect(CAPABILITY_MIN_ROLE).toEqual(EXPECTED_MIN_ROLE)
  })

  it("assigns every capability a valid role (exhaustive, no ungated capability)", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(ADMIN_ROLES).toContain(CAPABILITY_MIN_ROLE[cap])
    }
  })

  it("ranks roles read_only < admin < super_admin", () => {
    expect(ROLE_RANK.read_only).toBeLessThan(ROLE_RANK.admin)
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.super_admin)
  })
})

describe("hasRole", () => {
  it("is true at or above the required rank, false below", () => {
    expect(hasRole("super_admin", "admin")).toBe(true)
    expect(hasRole("admin", "admin")).toBe(true)
    expect(hasRole("admin", "super_admin")).toBe(false)
    expect(hasRole("read_only", "admin")).toBe(false)
    expect(hasRole("read_only", "read_only")).toBe(true)
  })
})

describe("roleHasCapability", () => {
  it("super_admin has EVERY capability", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(roleHasCapability("super_admin", cap)).toBe(true)
    }
  })

  it("read_only has ONLY view + export", () => {
    for (const cap of ALL_CAPABILITIES) {
      const allowed = cap === "view" || cap === "export"
      expect(roleHasCapability("read_only", cap)).toBe(allowed)
    }
  })

  it("admin has the day-to-day surface but NOT the super-only actions", () => {
    const superOnly: Capability[] = ["billing.convert", "user.delete", "admin.manage", "knowledge.manage"]
    for (const cap of ALL_CAPABILITIES) {
      expect(roleHasCapability("admin", cap)).toBe(!superOnly.includes(cap))
    }
  })

  it("admin cannot delete users, convert billing, manage admins, or promote learnings", () => {
    expect(roleHasCapability("admin", "user.delete")).toBe(false)
    expect(roleHasCapability("admin", "billing.convert")).toBe(false)
    expect(roleHasCapability("admin", "admin.manage")).toBe(false)
    expect(roleHasCapability("admin", "knowledge.manage")).toBe(false)
  })

  it("admin can do the day-to-day surface", () => {
    expect(roleHasCapability("admin", "org.manage")).toBe(true)
    expect(roleHasCapability("admin", "user.manage")).toBe(true)
    expect(roleHasCapability("admin", "user.impersonate")).toBe(true)
    expect(roleHasCapability("admin", "demo.manage")).toBe(true)
    expect(roleHasCapability("admin", "waitlist.manage")).toBe(true)
    expect(roleHasCapability("admin", "email.send")).toBe(true)
    expect(roleHasCapability("admin", "org.delete")).toBe(true)
  })
})

describe("normalizeRole", () => {
  it("passes through the three valid roles", () => {
    for (const r of ADMIN_ROLES) {
      expect(normalizeRole(r)).toBe(r)
    }
  })

  it("resolves unknown / null / empty to 'admin' — never locks out, but not god mode (SEC-M4)", () => {
    for (const v of [undefined, null, "", "owner", "READ_ONLY"]) {
      expect(normalizeRole(v)).toBe("admin")
    }
    // The fallback keeps day-to-day admin access...
    expect(roleHasCapability(normalizeRole("garbage"), "org.manage")).toBe(true)
    // ...but must NOT silently grant the super_admin-only governance/destructive caps.
    expect(roleHasCapability(normalizeRole("garbage"), "admin.manage")).toBe(false)
    expect(roleHasCapability(normalizeRole("garbage"), "user.delete")).toBe(false)
    expect(roleHasCapability(normalizeRole("garbage"), "billing.convert")).toBe(false)
  })
})

describe("isValidRole", () => {
  it("is strict — only the three exact roles", () => {
    expect(isValidRole("admin")).toBe(true)
    expect(isValidRole("super_admin")).toBe(true)
    expect(isValidRole("read_only")).toBe(true)
    expect(isValidRole("owner")).toBe(false)
    expect(isValidRole(undefined)).toBe(false)
    expect(isValidRole(null)).toBe(false)
    expect(isValidRole("")).toBe(false)
  })
})

describe("CapabilityError", () => {
  it("carries the capability + role and is an Error", () => {
    const e = new CapabilityError("nope", "user.delete", "admin")
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe("CapabilityError")
    expect(e.capability).toBe("user.delete")
    expect(e.role).toBe("admin")
  })
})
