import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  planCompetitorTrim,
  resolveTrimSelection,
  trimSummary,
  type TrimLocation,
} from "@/lib/billing/competitor-trim"

// Downgrading to a smaller competitor cap. Bryan's call 2026-08-22: a deselect screen in the
// change-plan flow, so the customer picks which competitors to keep rather than having an arbitrary
// subset chosen for them.

const c = (id: string, name: string, createdAt: string | null) => ({ id, name, createdAt })

/** Standard (5 active) downgrading to Starter (cap 3). */
const oneLocation: TrimLocation[] = [
  {
    locationId: "loc_a",
    locationName: "Sugarbacon",
    cap: 3,
    competitors: [
      c("c5", "Fifth", "2026-05-05T00:00:00Z"),
      c("c1", "First", "2026-01-01T00:00:00Z"),
      c("c3", "Third", "2026-03-03T00:00:00Z"),
      c("c2", "Second", "2026-02-02T00:00:00Z"),
      c("c4", "Fourth", "2026-04-04T00:00:00Z"),
    ],
  },
]

describe("which locations need a decision", () => {
  it("returns only locations that are actually over the new cap", () => {
    const trims = planCompetitorTrim([
      ...oneLocation,
      {
        locationId: "loc_b",
        locationName: "Within cap",
        cap: 3,
        competitors: [c("x1", "One", "2026-01-01T00:00:00Z"), c("x2", "Two", "2026-01-02T00:00:00Z")],
      },
    ])
    // A location already inside the cap needs no decision, and showing it would invite a customer
    // to remove something they did not have to.
    expect(trims.map((t) => t.locationId)).toEqual(["loc_a"])
  })

  it("says how many must go", () => {
    const [trim] = planCompetitorTrim(oneLocation)
    expect(trim!.mustRemove).toBe(2)
  })

  it("returns nothing when no location is over cap, so the downgrade needs no screen", () => {
    expect(
      planCompetitorTrim([{ ...oneLocation[0]!, cap: 5 }]),
    ).toEqual([])
  })
})

describe("the default selection matches what the customer already gets", () => {
  it("pre-ticks the OLDEST cap-many, in the same order the nightly brief truncates", () => {
    // This is the property that makes confirming-without-changing a no-op rather than a surprise:
    // the dossier orders created_at ascending before slicing, so the oldest N are exactly the ones
    // already being analysed.
    const [trim] = planCompetitorTrim(oneLocation)
    expect(trim!.suggestedKeepIds).toEqual(["c1", "c2", "c3"])
  })

  it("shows the list oldest first, whatever order the rows arrived in", () => {
    const [trim] = planCompetitorTrim(oneLocation)
    expect(trim!.competitors.map((x) => x.id)).toEqual(["c1", "c2", "c3", "c4", "c5"])
  })

  it("sorts rows with no timestamp LAST so a null cannot win a keep slot", () => {
    const [trim] = planCompetitorTrim([
      {
        locationId: "l",
        locationName: "L",
        cap: 2,
        competitors: [
          c("nul", "No date", null),
          c("old", "Old", "2026-01-01T00:00:00Z"),
          c("new", "New", "2026-06-01T00:00:00Z"),
        ],
      },
    ])
    expect(trim!.suggestedKeepIds).toEqual(["old", "new"])
  })

  it("is deterministic when two rows share a timestamp", () => {
    const same = "2026-01-01T00:00:00Z"
    const a = planCompetitorTrim([
      { locationId: "l", locationName: "L", cap: 1, competitors: [c("b", "B", same), c("a", "A", same)] },
    ])
    const b = planCompetitorTrim([
      { locationId: "l", locationName: "L", cap: 1, competitors: [c("a", "A", same), c("b", "B", same)] },
    ])
    expect(a[0]!.suggestedKeepIds).toEqual(b[0]!.suggestedKeepIds)
  })
})

describe("turning a keep list into a remove list", () => {
  const trims = planCompetitorTrim(oneLocation)

  it("removes everything not kept", () => {
    const r = resolveTrimSelection(trims, ["c1", "c2", "c3"])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.removeIds.sort()).toEqual(["c4", "c5"])
  })

  it("honours a different choice than the suggested one", () => {
    // The whole point of the screen: the customer may want the NEWEST three.
    const r = resolveTrimSelection(trims, ["c3", "c4", "c5"])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.removeIds.sort()).toEqual(["c1", "c2"])
  })

  it("allows keeping FEWER than the cap", () => {
    // Dropping more than required is the customer's business.
    const r = resolveTrimSelection(trims, ["c1"])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.removeIds).toHaveLength(4)
  })

  it("refuses keeping MORE than the cap", () => {
    const r = resolveTrimSelection(trims, ["c1", "c2", "c3", "c4"])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/at most 3 to keep at Sugarbacon/)
  })

  it("refuses an id that was never on the screen, rather than ignoring it", () => {
    // A stale page, or a crafted request. Either way, silently dropping the unknown id would let a
    // caller keep a competitor at a location that was never up for a decision.
    const r = resolveTrimSelection(trims, ["c1", "c2", "not_mine"])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/out of date/i)
  })

  it("an empty keep list removes everything on the screen, and does not throw", () => {
    // Fails safe: too few kept removes more than intended, which is visible and reversible, rather
    // than keeping too many, which would silently leave the customer over cap.
    const r = resolveTrimSelection(trims, [])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.removeIds).toHaveLength(5)
  })

  it("never touches a location that was within cap", () => {
    const withSecond = planCompetitorTrim([
      ...oneLocation,
      {
        locationId: "loc_b",
        locationName: "Within cap",
        cap: 3,
        competitors: [c("x1", "One", "2026-01-01T00:00:00Z")],
      },
    ])
    const r = resolveTrimSelection(withSecond, ["c1", "c2", "c3"])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.removeIds).not.toContain("x1")
  })

  it("enforces the cap per location, not across the org", () => {
    const two = planCompetitorTrim([
      oneLocation[0]!,
      {
        locationId: "loc_b",
        locationName: "Second site",
        cap: 3,
        competitors: [
          c("d1", "D1", "2026-01-01T00:00:00Z"),
          c("d2", "D2", "2026-01-02T00:00:00Z"),
          c("d3", "D3", "2026-01-03T00:00:00Z"),
          c("d4", "D4", "2026-01-04T00:00:00Z"),
        ],
      },
    ])
    // 3 at each location is fine; 6 at one is not. The cap is per location (ALT-756).
    expect(resolveTrimSelection(two, ["c1", "c2", "c3", "d1", "d2", "d3"]).ok).toBe(true)
    const overOne = resolveTrimSelection(two, ["c1", "c2", "c3", "c4", "d1", "d2"])
    expect(overOne.ok).toBe(false)
  })
})

describe("what the confirm button says", () => {
  it("names the location when there is one", () => {
    const trims = planCompetitorTrim(oneLocation)
    expect(trimSummary(trims, 2)).toBe("2 competitors at Sugarbacon will stop being watched.")
  })

  it("counts locations when there are several", () => {
    const trims = planCompetitorTrim([
      oneLocation[0]!,
      {
        locationId: "loc_b",
        locationName: "Second",
        cap: 1,
        competitors: [c("d1", "D1", "2026-01-01T00:00:00Z"), c("d2", "D2", "2026-01-02T00:00:00Z")],
      },
    ])
    expect(trimSummary(trims, 3)).toMatch(/across 2 locations/)
  })

  it("singularises, and says plainly when nothing goes", () => {
    const trims = planCompetitorTrim(oneLocation)
    expect(trimSummary(trims, 1)).toMatch(/^1 competitor at/)
    expect(trimSummary(trims, 0)).toBe("Nothing will stop being watched.")
  })

  it("uses no dash and names no vendor", () => {
    const trims = planCompetitorTrim(oneLocation)
    for (const n of [0, 1, 4]) {
      expect(trimSummary(trims, n)).not.toMatch(/[—–]/)
    }
  })
})

// ── The route and the screen, by source scan ─────────────────────────────────────────────────

describe("change-plan pauses for a decision rather than downgrading over the cap", () => {
  const ROOT = resolve(__dirname, "..", "..", "..")
  const route = () => readFileSync(join(ROOT, "app/api/stripe/change-plan/route.ts"), "utf8")
  const ui = () =>
    readFileSync(join(ROOT, "app/(dashboard)/settings/billing/plan-change-tiles-pass.tsx"), "utf8")

  it("answers the first call with a selection payload, not a silent downgrade", () => {
    const s = route()
    expect(s).toMatch(/reason: "needs_competitor_selection"/)
    expect(s).toMatch(/status: 409/)
    expect(s).toMatch(/suggestedKeepIds/)
  })

  it("validates the keep list through the tested resolver rather than trusting the body", () => {
    const s = route()
    expect(s).toMatch(/resolveTrimSelection\(trims, keepCompetitorIds\)/)
  })

  it("adds PURCHASED competitor slots to the new tier's cap", () => {
    // A customer who bought slots keeps them across a plan change: they are billed separately, so
    // losing them with the old tier would be taking something they still pay for.
    expect(route()).toMatch(/cap: newCap \+ Math\.max\(0, l\.competitors_purchased/)
  })

  it("trims AFTER the plan change lands, never before", () => {
    // The other order strips competitors and then, if Stripe refuses, leaves the customer on the
    // plan they were trying to leave with data gone for nothing.
    const s = route()
    const applyIdx = s.indexOf("await applySubscriptionToOrg(")
    const trimIdx = s.indexOf("update({ is_active: false })")
    expect(applyIdx, "apply call not found").toBeGreaterThan(0)
    expect(trimIdx, "trim write not found").toBeGreaterThan(0)
    expect(trimIdx).toBeGreaterThan(applyIdx)
  })

  it("stops watching by SOFT delete, so history survives and re-adding restores it", () => {
    const s = route()
    expect(s).toMatch(/update\(\{ is_active: false \}\)/)
    expect(s).not.toMatch(/\.delete\(\)\s*\n?\s*\.in\("id", removeIds\)/)
  })

  it("tells the customer if the plan changed but the trim did not", () => {
    const s = route()
    expect(s).toMatch(/warning:/)
    expect(s).toMatch(/trimming .* FAILED|trimming \$\{removeIds\.length\}/)
  })

  it("the screen intercepts the 409 BEFORE it becomes a red error", () => {
    // classifyBillingMutation would render this as a failure. It is not one: the downgrade is legal
    // and simply needs a decision, so the interception has to come first.
    const s = ui()
    const trimIdx = s.indexOf('payload?.reason === "needs_competitor_selection"')
    const classifyIdx = s.indexOf("classifyBillingMutation(res.ok, payload)")
    expect(trimIdx, "the 409 branch is missing").toBeGreaterThan(0)
    expect(trimIdx).toBeLessThan(classifyIdx)
  })

  it("pre-ticks what the customer already gets, so confirming unchanged is a no-op", () => {
    expect(ui()).toMatch(/new Set\(selection\.flatMap\(\(s\) => s\.suggestedKeepIds\)\)/)
  })

  it("makes the cap obvious by disabling, not by erroring after the fact", () => {
    const s = ui()
    expect(s).toMatch(/const blocked = !kept && keptHere >= s\.cap/)
    expect(s).toMatch(/disabled=\{blocked \|\| loading !== null\}/)
  })

  it("offers a way out that is not the downgrade", () => {
    expect(ui()).toMatch(/Keep my current plan/)
  })

  it("says the history is kept, because that is the thing a customer worries about", () => {
    expect(ui()).toMatch(/history is kept/i)
  })
})
