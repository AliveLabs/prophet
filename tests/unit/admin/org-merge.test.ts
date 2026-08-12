import { describe, it, expect } from "vitest"
import {
  demoteIncomingOwner,
  resolveMergedRole,
  mergeSourcesIntoTarget,
  type MergeSourcePorts,
  type MergeSourceSnapshot,
} from "@/lib/admin/org-merge"

describe("demoteIncomingOwner", () => {
  it("demotes owner to admin", () => {
    expect(demoteIncomingOwner("owner")).toBe("admin")
  })

  it("passes admin and member through unchanged", () => {
    expect(demoteIncomingOwner("admin")).toBe("admin")
    expect(demoteIncomingOwner("member")).toBe("member")
  })
})

describe("resolveMergedRole", () => {
  it("inserts a brand-new member (no existing target role) as-is", () => {
    expect(resolveMergedRole(null, "member")).toBe("member")
    expect(resolveMergedRole(null, "admin")).toBe("admin")
  })

  it("a brand-new member never lands as owner, even if they owned the source", () => {
    expect(resolveMergedRole(null, "owner")).toBe("admin")
  })

  it("the target's real owner is never displaced by an incoming (demoted) owner", () => {
    // This is the Fog Harbor invariant: Bob owns the target; merging Lauren's and Nicki's
    // orgs (where each was also 'owner' of their own duplicate) must not touch Bob's role.
    expect(resolveMergedRole("owner", "owner")).toBe("owner")
    expect(resolveMergedRole("owner", "admin")).toBe("owner")
    expect(resolveMergedRole("owner", "member")).toBe("owner")
  })

  it("higher role wins regardless of which side it's on", () => {
    expect(resolveMergedRole("admin", "member")).toBe("admin")
    expect(resolveMergedRole("member", "admin")).toBe("admin")
    // incoming owner demotes to admin, which still outranks an existing member
    expect(resolveMergedRole("member", "owner")).toBe("admin")
  })

  it("equal roles resolve to that role", () => {
    expect(resolveMergedRole("member", "member")).toBe("member")
    expect(resolveMergedRole("admin", "admin")).toBe("admin")
  })

  it("treats an unrecognized role as the lowest rank rather than throwing", () => {
    expect(resolveMergedRole("admin", "some-future-role")).toBe("admin")
    expect(resolveMergedRole(null, "some-future-role")).toBe("some-future-role")
  })
})

// ---------------------------------------------------------------------------
// mergeSourcesIntoTarget — ordering + idempotency, driven entirely by fakes (no DB).
// ---------------------------------------------------------------------------

type Call = { step: string; sourceOrgId: string }

/** An in-memory fake of MergeSourcePorts that logs call order and can be told to fail. */
function makeFakePorts(opts: {
  sources: Record<string, MergeSourceSnapshot | undefined>
  failStep?: { sourceOrgId: string; step: "moveMembers" | "repointProfiles" | "verify" }
  danglingAfterRepoint?: Set<string>
}) {
  const calls: Call[] = []
  const deleted = new Set<string>()

  const ports: MergeSourcePorts = {
    async loadSource(sourceOrgId) {
      calls.push({ step: "loadSource", sourceOrgId })
      return opts.sources[sourceOrgId] ?? null
    },
    async moveMembers(sourceOrgId) {
      calls.push({ step: "moveMembers", sourceOrgId })
      if (opts.failStep?.sourceOrgId === sourceOrgId && opts.failStep.step === "moveMembers") {
        throw new Error("boom: moveMembers")
      }
      return { membersMoved: 2 }
    },
    async repointProfiles(sourceOrgId) {
      calls.push({ step: "repointProfiles", sourceOrgId })
      if (opts.failStep?.sourceOrgId === sourceOrgId && opts.failStep.step === "repointProfiles") {
        throw new Error("boom: repointProfiles")
      }
      return { profilesRepointed: 1 }
    },
    async verifyNoDanglingProfiles(sourceOrgId) {
      calls.push({ step: "verify", sourceOrgId })
      if (opts.failStep?.sourceOrgId === sourceOrgId && opts.failStep.step === "verify") {
        return false
      }
      return !opts.danglingAfterRepoint?.has(sourceOrgId)
    },
    async deleteSource(sourceOrgId) {
      calls.push({ step: "deleteSource", sourceOrgId })
      deleted.add(sourceOrgId)
    },
  }

  return { ports, calls, deleted }
}

const snap = (id: string, over: Partial<MergeSourceSnapshot> = {}): MergeSourceSnapshot => ({
  id,
  name: `org-${id}`,
  orgKind: "real",
  deletedAt: null,
  ...over,
})

describe("mergeSourcesIntoTarget — ordering guarantee", () => {
  it("runs move -> repoint -> verify -> delete, in that order, for a clean source", async () => {
    const { ports, calls, deleted } = makeFakePorts({ sources: { s1: snap("s1") } })
    const results = await mergeSourcesIntoTarget(["s1"], ports)

    expect(results).toEqual([
      {
        sourceOrgId: "s1",
        sourceName: "org-s1",
        sourceKind: "real",
        status: "merged",
        membersMoved: 2,
        profilesRepointed: 1,
      },
    ])
    expect(deleted.has("s1")).toBe(true)
    expect(calls.map((c) => c.step)).toEqual([
      "loadSource",
      "moveMembers",
      "repointProfiles",
      "verify",
      "deleteSource",
    ])
  })

  it("never deletes when verify reports a dangling profile pointer", async () => {
    const { ports, calls, deleted } = makeFakePorts({
      sources: { s1: snap("s1") },
      danglingAfterRepoint: new Set(["s1"]),
    })
    const results = await mergeSourcesIntoTarget(["s1"], ports)

    expect(results[0].status).toBe("failed")
    expect(results[0].error).toMatch(/still points at this source/)
    expect(deleted.has("s1")).toBe(false)
    expect(calls.some((c) => c.step === "deleteSource")).toBe(false)
  })

  it("never deletes when moveMembers throws — and never even reaches verify", async () => {
    const { ports, calls, deleted } = makeFakePorts({
      sources: { s1: snap("s1") },
      failStep: { sourceOrgId: "s1", step: "moveMembers" },
    })
    const results = await mergeSourcesIntoTarget(["s1"], ports)

    expect(results[0].status).toBe("failed")
    expect(results[0].membersMoved).toBe(0)
    expect(results[0].profilesRepointed).toBe(0)
    expect(deleted.has("s1")).toBe(false)
    expect(calls.map((c) => c.step)).toEqual(["loadSource", "moveMembers"])
  })

  it("never deletes when repointProfiles throws, but keeps the members-moved count it already has", async () => {
    const { ports, calls, deleted } = makeFakePorts({
      sources: { s1: snap("s1") },
      failStep: { sourceOrgId: "s1", step: "repointProfiles" },
    })
    const results = await mergeSourcesIntoTarget(["s1"], ports)

    expect(results[0].status).toBe("failed")
    expect(results[0].membersMoved).toBe(2)
    expect(results[0].profilesRepointed).toBe(0)
    expect(deleted.has("s1")).toBe(false)
    expect(calls.map((c) => c.step)).toEqual(["loadSource", "moveMembers", "repointProfiles"])
  })

  it("treats a missing source as already merged (idempotent re-run), not an error", async () => {
    const { ports, calls, deleted } = makeFakePorts({ sources: {} })
    const results = await mergeSourcesIntoTarget(["gone"], ports)

    expect(results).toEqual([
      {
        sourceOrgId: "gone",
        sourceName: null,
        sourceKind: null,
        status: "skipped_missing",
        membersMoved: 0,
        profilesRepointed: 0,
      },
    ])
    expect(deleted.size).toBe(0)
    expect(calls.map((c) => c.step)).toEqual(["loadSource"])
  })

  it("treats an already soft-deleted source as already merged", async () => {
    const { ports, deleted } = makeFakePorts({
      sources: { s1: snap("s1", { deletedAt: "2026-08-01T00:00:00.000Z" }) },
    })
    const results = await mergeSourcesIntoTarget(["s1"], ports)

    expect(results[0].status).toBe("skipped_already_deleted")
    expect(deleted.has("s1")).toBe(false)
  })

  it("processes multiple sources independently: one failure does not block the others", async () => {
    const { ports, deleted } = makeFakePorts({
      sources: { s1: snap("s1"), s2: snap("s2") },
      failStep: { sourceOrgId: "s1", step: "verify" },
    })
    const results = await mergeSourcesIntoTarget(["s1", "s2"], ports)

    const bySource = new Map(results.map((r) => [r.sourceOrgId, r]))
    expect(bySource.get("s1")?.status).toBe("failed")
    expect(bySource.get("s2")?.status).toBe("merged")
    expect(deleted.has("s1")).toBe(false)
    expect(deleted.has("s2")).toBe(true)
  })
})
