import { describe, it, expect } from "vitest"
import {
  classifyPlaceCollision,
  type CollisionOrgRow,
} from "@/lib/onboarding/org-collision"

function row(over: Partial<CollisionOrgRow> = {}): CollisionOrgRow {
  return {
    orgId: "org-1",
    orgKind: "real",
    deletedAt: null,
    isMember: false,
    ...over,
  }
}

describe("classifyPlaceCollision", () => {
  it("returns none when no org owns the place", () => {
    expect(classifyPlaceCollision([])).toEqual({ kind: "none" })
  })

  it("returns real for a live customer org (the Fog Harbor case: no second org, no ownership)", () => {
    expect(classifyPlaceCollision([row({ orgKind: "real" })])).toEqual({
      kind: "real",
      orgId: "org-1",
    })
  })

  it("treats a null org_kind as real rather than falling through to the demo branch", () => {
    expect(classifyPlaceCollision([row({ orgKind: null })])).toEqual({
      kind: "real",
      orgId: "org-1",
    })
  })

  it("returns demo for a demo org (sales signal, not request-access)", () => {
    expect(classifyPlaceCollision([row({ orgKind: "demo" })])).toEqual({
      kind: "demo",
      orgId: "org-1",
    })
  })

  it("routes a test org down the demo branch: also an internal showcase, never self-serve", () => {
    expect(classifyPlaceCollision([row({ orgKind: "test" })])).toEqual({
      kind: "demo",
      orgId: "org-1",
    })
  })

  it("ignores soft-deleted orgs: a deleted org holds no place", () => {
    expect(
      classifyPlaceCollision([row({ deletedAt: "2026-08-01T00:00:00Z" })])
    ).toEqual({ kind: "none" })
    expect(
      classifyPlaceCollision([
        row({ orgId: "dead", deletedAt: "2026-08-01T00:00:00Z" }),
        row({ orgId: "live", orgKind: "demo" }),
      ])
    ).toEqual({ kind: "demo", orgId: "live" })
  })

  it("membership outranks kind: a member of the colliding org is sent home, not to request access", () => {
    expect(
      classifyPlaceCollision([row({ orgKind: "real", isMember: true })])
    ).toEqual({ kind: "already_member", orgId: "org-1" })
    expect(
      classifyPlaceCollision([
        row({ orgId: "other", orgKind: "real" }),
        row({ orgId: "mine", orgKind: "demo", isMember: true }),
      ])
    ).toEqual({ kind: "already_member", orgId: "mine" })
  })

  it("real outranks demo when both own the place (pre-cleanup duplicates)", () => {
    expect(
      classifyPlaceCollision([
        row({ orgId: "demo-org", orgKind: "demo" }),
        row({ orgId: "real-org", orgKind: "real" }),
      ])
    ).toEqual({ kind: "real", orgId: "real-org" })
  })

  it("dedupes an org that owns two locations at the same place", () => {
    expect(
      classifyPlaceCollision([
        row({ orgId: "org-1", orgKind: "real" }),
        row({ orgId: "org-1", orgKind: "real" }),
      ])
    ).toEqual({ kind: "real", orgId: "org-1" })
  })

  it("a deleted duplicate of a live org does not suppress the live one", () => {
    // Ordering matters: the deleted row is dropped BEFORE dedupe, so the live row still
    // registers even though it shares an org id with nothing else.
    expect(
      classifyPlaceCollision([
        row({ orgId: "org-1", deletedAt: "2026-07-01T00:00:00Z" }),
        row({ orgId: "org-2", orgKind: "real" }),
      ])
    ).toEqual({ kind: "real", orgId: "org-2" })
  })
})
