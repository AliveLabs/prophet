// Team-management rules (ALT-457 phase 1). These protect an org from being left
// unmanageable or having elevated access quietly spread, so they're tested directly rather
// than only through the UI that mirrors them.

import { describe, it, expect } from "vitest"
import {
  assessInviteRole,
  assessRemoval,
  canManageTeam,
  isInvitableRole,
  normalizeInviteEmail,
} from "@/lib/team/guards"

describe("canManageTeam", () => {
  it("allows owner and admin only", () => {
    expect(canManageTeam("owner")).toBe(true)
    expect(canManageTeam("admin")).toBe(true)
    expect(canManageTeam("member")).toBe(false)
    expect(canManageTeam(null)).toBe(false)
    expect(canManageTeam(undefined)).toBe(false)
    expect(canManageTeam("")).toBe(false)
  })
})

describe("normalizeInviteEmail", () => {
  it("trims and lowercases so the same person can't be added twice", () => {
    expect(normalizeInviteEmail("  Larry@SugarBacon.com ")).toBe("larry@sugarbacon.com")
  })

  it("rejects unusable input", () => {
    for (const bad of ["", "   ", null, undefined, "notanemail", "no@domain", "a b@c.com"]) {
      expect(normalizeInviteEmail(bad as string), String(bad)).toBeNull()
    }
  })

  it("rejects absurdly long addresses", () => {
    expect(normalizeInviteEmail(`${"a".repeat(250)}@b.com`)).toBeNull()
  })
})

describe("isInvitableRole", () => {
  it("never lets owner be handed out by invite (ownership moves by transfer)", () => {
    expect(isInvitableRole("member")).toBe(true)
    expect(isInvitableRole("admin")).toBe(true)
    expect(isInvitableRole("owner")).toBe(false)
    expect(isInvitableRole("superuser")).toBe(false)
  })
})

describe("assessInviteRole", () => {
  it("lets an owner invite members and admins", () => {
    expect(assessInviteRole("owner", "member").ok).toBe(true)
    expect(assessInviteRole("owner", "admin").ok).toBe(true)
  })

  it("lets an admin invite members but NOT other admins", () => {
    expect(assessInviteRole("admin", "member").ok).toBe(true)
    const res = assessInviteRole("admin", "admin")
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/only an owner/i)
  })

  it("blocks plain members entirely", () => {
    expect(assessInviteRole("member", "member").ok).toBe(false)
  })

  it("rejects a bogus role", () => {
    expect(assessInviteRole("owner", "owner").ok).toBe(false)
    expect(assessInviteRole("owner", "wizard").ok).toBe(false)
  })
})

describe("assessRemoval", () => {
  const base = {
    targetUserId: "target",
    targetRole: "member",
    actorUserId: "actor",
    actorRole: "owner",
    ownerCount: 1,
  }

  it("lets a manager remove a member", () => {
    expect(assessRemoval(base).ok).toBe(true)
    expect(assessRemoval({ ...base, actorRole: "admin" }).ok).toBe(true)
  })

  it("blocks a plain member from removing anyone", () => {
    expect(assessRemoval({ ...base, actorRole: "member" }).ok).toBe(false)
  })

  it("won't let anyone remove themselves", () => {
    const res = assessRemoval({ ...base, targetUserId: "actor" })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/yourself/i)
  })

  it("never leaves the org without an owner", () => {
    const res = assessRemoval({
      ...base,
      targetUserId: "other-owner",
      targetRole: "owner",
      ownerCount: 1,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/transfer ownership/i)
  })

  it("allows removing an owner when another owner remains", () => {
    expect(
      assessRemoval({ ...base, targetUserId: "other-owner", targetRole: "owner", ownerCount: 2 }).ok
    ).toBe(true)
  })

  it("won't let an admin remove an owner (no privilege escalation)", () => {
    const res = assessRemoval({
      ...base,
      actorRole: "admin",
      targetUserId: "the-owner",
      targetRole: "owner",
      ownerCount: 2,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/only an owner/i)
  })
})
