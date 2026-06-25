// ---------------------------------------------------------------------------
// P16 — the upgraded grassroots / guerrilla skill: entity-grounded archetypes.
//
// Covers the upgrade's invariants (spec §3.2):
//  - each entity-anchored archetype fires ONLY with a named partner anchor (or a
//    dated event window); an entity-LESS play is SUPPRESSED (the core upgrade);
//  - generic chamber/flyer/"partner with local businesses" advice is penalized + dropped;
//  - benchmark economics SCALE by the location's check-average + the partner size band,
//    and NEVER fabricate an absolute figure (the number traces to its inputs);
//  - an empty/absent partner catalog → number-free fallback = today (no new archetype fires);
//  - the partner-catalog populator's partner-type mapping is correct.
// Deterministic (stubbed transport; no Places network).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest"
import {
  guerrillaMarketingSkill,
  projectSpiritNightEconomics,
  ownCheckAverage,
  hasNameableAnchor,
  isGenericAdvice,
  namesAnAnchor,
  GRASSROOTS_ARCHETYPES,
} from "@/lib/skills/guerrilla-marketing/skill"
import {
  partnerTypeForPlacesType,
  PARTNER_TAXONOMY,
  PARTNER_TYPE_LABELS,
  buildPartnerCatalog,
  type PartnerType,
} from "@/lib/local/partner-catalog"
import { runProducerSkill } from "@/lib/skills/run"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier, PartnerEntitySummary } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { NormalizedEvent } from "@/lib/events/types"
import type { Transport } from "@/lib/ai/provider"
import type { EnrichedRecommendation } from "@/lib/skills/types"

// ── tiny builders ─────────────────────────────────────────────────────────────
const sig = (insight_type: string, title = insight_type, evidence: Record<string, unknown> = {}): GeneratedInsight => ({
  insight_type,
  title,
  summary: "",
  confidence: "medium",
  severity: "info",
  evidence,
  recommendations: [],
})

const partner = (
  name: string,
  partnerType: PartnerType,
  opts: { distanceMi?: number; sizeBand?: string } = {},
): PartnerEntitySummary => ({
  name,
  partnerType,
  partnerLabel: PARTNER_TYPE_LABELS[partnerType],
  distanceMi: opts.distanceMi ?? 0.8,
  sizeBand: opts.sizeBand ?? "medium",
  sizeProxyLow: 40,
  sizeProxyHigh: 60,
  sizeProxyKind: "enrollment band",
})

const datedEvent = (title: string, when = "2026-07-04T11:00:00Z"): NormalizedEvent => ({
  uid: title,
  title,
  startDatetime: when,
  venue: { name: title },
  distanceMiles: 0.3,
  magnitude: "moderate",
  role: "local_foot",
  source: "dataforseo_google_events",
  keyword: "events",
  dateRange: "week",
})

/** A dossier with a populated partner catalog + a real grassroots signal to ground on. */
function withCatalog(
  partners: PartnerEntitySummary[],
  sigs: GeneratedInsight[],
  events: NormalizedEvent[] = [],
): Dossier {
  return {
    ...competitiveWeekDossier,
    ruleOutputs: sigs,
    partnerEntities: partners,
    demandCalendar: { ...competitiveWeekDossier.demandCalendar, events },
  }
}

// ── wiring ──────────────────────────────────────────────────────────────────
describe("grassroots upgrade — wiring", () => {
  it("keeps its own grassroots category + reasoning tier, and bumps to the upgraded knowledge version", () => {
    expect(guerrillaMarketingSkill.id).toBe("guerrilla-marketing")
    expect(guerrillaMarketingSkill.category).toBe("grassroots")
    expect(guerrillaMarketingSkill.deep).toBeFalsy()
    expect(guerrillaMarketingSkill.tier).toBe("reasoning")
    expect(guerrillaMarketingSkill.knowledgeVersion).toBe("guerrilla@v2")
  })
  it("declares the P14 learning hook with grassroots as the click lead-domain", () => {
    expect(guerrillaMarketingSkill.learning?.playTypeLeadDomain).toBe("grassroots")
    expect(guerrillaMarketingSkill.learning?.streams).toContain("external")
  })
  it("exposes the seven archetypes (workplace_lunch renamed from catering_lunch_driver; +sponsorship, +general_outreach)", () => {
    expect([...GRASSROOTS_ARCHETYPES]).toEqual([
      "spirit_night",
      "workplace_lunch",
      "reciprocal_partner",
      "event_activation",
      "sponsorship",
      "general_outreach",
      "earned_media_stunt",
    ])
  })
})

// ── the partner-catalog populator's partner-type mapping ────────────────────────
describe("partner-catalog populator — partner-type mapping is correct", () => {
  it("maps the canonical Places types onto the right partner type", () => {
    expect(partnerTypeForPlacesType("primary_school")).toBe("school")
    expect(partnerTypeForPlacesType("secondary_school")).toBe("school")
    expect(partnerTypeForPlacesType("corporate_office")).toBe("office")
    expect(partnerTypeForPlacesType("coworking_space")).toBe("office")
    expect(partnerTypeForPlacesType("hospital")).toBe("hospital")
    expect(partnerTypeForPlacesType("gym")).toBe("gym")
    expect(partnerTypeForPlacesType("church")).toBe("church")
    expect(partnerTypeForPlacesType("place_of_worship")).toBe("church")
    expect(partnerTypeForPlacesType("car_dealer")).toBe("dealership")
    expect(partnerTypeForPlacesType("movie_theater")).toBe("theater")
    expect(partnerTypeForPlacesType("bakery")).toBe("bakery")
    expect(partnerTypeForPlacesType("market")).toBe("farmers_market")
  })
  it("returns null for a non-partner / unknown type (so we never catalog a non-partner)", () => {
    expect(partnerTypeForPlacesType("restaurant")).toBeNull()
    expect(partnerTypeForPlacesType("gas_station")).toBeNull()
    expect(partnerTypeForPlacesType(null)).toBeNull()
    expect(partnerTypeForPlacesType(undefined)).toBeNull()
  })
  it("every taxonomy row resolves to a labelled partner type (no orphan types)", () => {
    for (const t of PARTNER_TAXONOMY) {
      expect(PARTNER_TYPE_LABELS[t.partnerType]).toBeTruthy()
      expect(partnerTypeForPlacesType(t.includedType)).toBe(t.partnerType)
    }
  })
  it("does NOT catalog the Chamber of Commerce (experts-first: founder guess is not the spec)", () => {
    // No taxonomy row targets a chamber/networking type — the leverage is borrowed AUDIENCE, not mixers.
    expect(PARTNER_TAXONOMY.some((t) => /chamber|networking/i.test(t.includedType))).toBe(false)
  })
})

// ── the populator builds a catalog from stubbed Places (no network) ─────────────
describe("partner-catalog populator — buildPartnerCatalog tags + sizes from a stubbed sweep", () => {
  it("tags each swept place by partner type, dedups by placeId, sorts by distance", async () => {
    // Stub fetchNearbyPlaces so the sweep is deterministic + offline.
    const mod = await import("@/lib/places/google")
    const spy = vi
      .spyOn(mod, "fetchNearbyPlaces")
      .mockImplementation(async (_lat, _lng, opts) => {
        const t = opts.includedTypes[0]
        if (t === "secondary_school")
          return [{ placeId: "sch1", name: "Forney High School", primaryType: "secondary_school", types: [], distanceMeters: 1207 } as never]
        if (t === "corporate_office")
          return [{ placeId: "off1", name: "Pinnacle Tower", primaryType: "corporate_office", types: [], distanceMeters: 805 } as never]
        return []
      })
    const cat = await buildPartnerCatalog(32.0, -96.0)
    spy.mockRestore()

    const school = cat.find((p) => p.placeId === "sch1")
    const office = cat.find((p) => p.placeId === "off1")
    expect(school?.partnerType).toBe("school")
    expect(school?.sizeBand).toBe("large") // secondary_school taxonomy band
    expect(office?.partnerType).toBe("office")
    // sorted by distance: the office (0.5mi) precedes the school (0.75mi)
    expect(cat[0].placeId).toBe("off1")
    expect(cat[0].sizeProxyLow).toBeGreaterThan(0)
  })
})

// ── check-average extraction (the scaling input) ────────────────────────────────
describe("ownCheckAverage — reads the dine-in check from the price signal (prod + fixture keys)", () => {
  it("reads prod's locationAvgPrice", () => {
    const d = withCatalog([], [sig("menu.price_positioning_shift", "x", { locationAvgPrice: 18.5, competitor: "X" })])
    expect(ownCheckAverage(d)).toBe(18.5)
  })
  it("reads the fixture's your_avg", () => {
    const d = withCatalog([], [sig("menu.price_positioning_shift", "x", { your_avg: 19.99 })])
    expect(ownCheckAverage(d)).toBe(19.99)
  })
  it("returns null when no price signal carries a check-average", () => {
    expect(ownCheckAverage(withCatalog([], [sig("events.new_high_signal_event")]))).toBeNull()
  })
})

// ── THE ANTI-FABRICATION TEST: economics scale by check-avg + size band ─────────
describe("projectSpiritNightEconomics — a PRIOR scaled by inputs, never a fabricated absolute", () => {
  it("with NO check-average, returns an ordinal (band-only) result with NO dollar figure", () => {
    const e = projectSpiritNightEconomics(null, "medium")
    expect(e.sizing).toBe("ordinal")
    expect(e.incrementalSales).toBeUndefined() // no money invented without a real check-average
    expect(e.groupDonation).toBeUndefined()
    expect(e.familiesLow).toBeGreaterThan(0) // the band-based family range is still surfaced
  })
  it("every dollar figure TRACES to the check-average (double the check ⇒ double the dollars, ±rounding)", () => {
    const a = projectSpiritNightEconomics(12, "medium")
    const b = projectSpiritNightEconomics(24, "medium")
    expect(a.incrementalSales).toBeDefined()
    // The number is a pure function of the check-average — doubling the input doubles the output
    // (allowing ≤1 for the single final round). NO hard-coded absolute could survive this.
    expect(Math.abs(b.incrementalSales!.low - a.incrementalSales!.low * 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(b.incrementalSales!.high - a.incrementalSales!.high * 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(b.groupDonation!.low - a.groupDonation!.low * 2)).toBeLessThanOrEqual(1)
    expect(a.basis.checkAverage).toBe(12) // the audit trail records the input
    // and a ZERO check-average could never be "rounded into" a positive figure
    expect(projectSpiritNightEconomics(0, "medium").incrementalSales).toBeUndefined()
  })
  it("a LARGER size band scales the projected sales UP (size proxy moves the number)", () => {
    const small = projectSpiritNightEconomics(15, "small")
    const large = projectSpiritNightEconomics(15, "large")
    expect(large.incrementalSales!.high).toBeGreaterThan(small.incrementalSales!.high)
  })
  it("there is NO hard-coded absolute: the donation share stays the 15-20% benchmark prior", () => {
    const e = projectSpiritNightEconomics(15, "medium")
    expect(e.donationSharePct).toEqual({ low: 15, high: 20 })
  })
})

// ── isGenericAdvice + namesAnAnchor: the named-anchor gate primitives ────────────
describe("the named-anchor gate primitives", () => {
  it("isGenericAdvice flags chamber/flyer/'partner with local businesses'/the old fallback line", () => {
    expect(isGenericAdvice("Join the Chamber of Commerce mixer")).toBe(true)
    expect(isGenericAdvice("Hand out flyers at the corner")).toBe(true)
    expect(isGenericAdvice("Partner with local businesses nearby")).toBe(true)
    expect(isGenericAdvice("Make one zero-budget move this week")).toBe(true)
    expect(isGenericAdvice("Run a spirit night with Forney High School PTA")).toBe(false)
  })
  it("namesAnAnchor is true only when the play names a real partner OR dated event from this dossier", () => {
    const d = withCatalog([partner("Forney High School", "school")], [sig("events.upcoming")], [datedEvent("July 4th Street Fair")])
    const namesPartner = { title: "Spirit night with Forney High School", rationale: "", recipe: [{ channel: "", audience: "Forney High School families", platforms: [], window: { note: "" } }] } as unknown as EnrichedRecommendation
    const namesEvent = { title: "QR at the July 4th Street Fair", rationale: "", recipe: [{ channel: "", audience: "fair-goers", platforms: [], window: { note: "" } }] } as unknown as EnrichedRecommendation
    const namesNothing = { title: "Do a fundraiser sometime", rationale: "", recipe: [{ channel: "", audience: "locals", platforms: [], window: { note: "" } }] } as unknown as EnrichedRecommendation
    expect(namesAnAnchor(namesPartner, d)).toBe(true)
    expect(namesAnAnchor(namesEvent, d)).toBe(true)
    expect(namesAnAnchor(namesNothing, d)).toBe(false)
  })
})

// ── hasNameableAnchor: the fail-soft gate ───────────────────────────────────────
describe("hasNameableAnchor — gates whether ANY entity-grounded archetype can fire", () => {
  it("false with an empty catalog + no dated events (→ number-free fallback = today)", () => {
    expect(hasNameableAnchor(withCatalog([], [sig("events.upcoming")]))).toBe(false)
  })
  it("true with a partner entity present", () => {
    expect(hasNameableAnchor(withCatalog([partner("Forney High School", "school")], [sig("traffic.new_slow_period")]))).toBe(true)
  })
  it("true with a dated event present (even with an empty catalog)", () => {
    expect(hasNameableAnchor(withCatalog([], [sig("events.upcoming")], [datedEvent("Street Fair")]))).toBe(true)
  })
})

// ── parse: each archetype fires ONLY with a named anchor; entity-less is SUPPRESSED ──
describe("parse — the named-anchor gate (the CORE upgrade)", () => {
  const baseRecipe = [{ channel: "outreach to the school", audience: "the group's families", platforms: [], window: { note: "a weeknight 2-3 weeks out" } }]
  const rawPlay = (over: Record<string, unknown>) => ({
    title: "x",
    rationale: "x",
    recipe: baseRecipe,
    confidence: "medium",
    leverage: { label: "high", basisInternal: "borrowed distribution" },
    evidenceRefs: ["traffic.new_slow_period"],
    ...over,
  })

  it("FIRES a spirit_night that names a real nearby school + grounds on a real signal", () => {
    const d = withCatalog([partner("Forney High School", "school")], [sig("traffic.new_slow_period", "Tuesday nights went quiet")])
    const plays = guerrillaMarketingSkill.parse(
      [rawPlay({ title: "Run a spirit night with Forney High School PTA", rationale: "A weeknight donation night; their families fill your slow Tuesday." })],
      d,
    )
    expect(plays).toHaveLength(1)
    expect(plays![0].knowledgeVersion).toBe("guerrilla@v2")
  })
  it("SUPPRESSES a play that grounds on a real signal but names NO partner or dated event", () => {
    const d = withCatalog([partner("Forney High School", "school")], [sig("traffic.new_slow_period")])
    const plays = guerrillaMarketingSkill.parse(
      [rawPlay({ title: "Run a fundraiser night", rationale: "Do a donation night for a local group sometime." })],
      d,
    )
    expect(plays).toEqual([]) // entity-less → suppressed
  })
  it("SUPPRESSES + PENALIZES generic chamber/flyer advice even if it cites a real signal", () => {
    const d = withCatalog([partner("Forney High School", "school")], [sig("traffic.new_slow_period")])
    const plays = guerrillaMarketingSkill.parse(
      [rawPlay({ title: "Join the Chamber of Commerce", rationale: "Network at the Chamber of Commerce mixer with Forney High School folks." })],
      d,
    )
    expect(plays).toEqual([])
  })
  it("SUPPRESSES a play that names a partner but cites NO grassroots signal (domain grounding holds)", () => {
    const d = withCatalog([partner("Forney High School", "school")], [sig("menu.signature_item_missing")])
    const plays = guerrillaMarketingSkill.parse(
      [rawPlay({ title: "Spirit night with Forney High School", rationale: "x", evidenceRefs: ["menu.signature_item_missing"] })],
      d,
    )
    expect(plays).toEqual([])
  })
  it("FIRES an event_activation that names a dated event even with an EMPTY catalog", () => {
    const d = withCatalog([], [sig("events.upcoming", "Street fair Saturday")], [datedEvent("July 4th Street Fair")])
    const plays = guerrillaMarketingSkill.parse(
      [rawPlay({ title: "QR-capture table at the July 4th Street Fair", rationale: "Capture leads at the July 4th Street Fair with a return code.", evidenceRefs: ["events.upcoming"] })],
      d,
    )
    expect(plays).toHaveLength(1)
  })
})

// ── empty catalog → number-free fallback = today (no new archetype fires) ───────
describe("fail-soft — empty/absent partner catalog leaves grassroots at today's behavior", () => {
  const failing: Transport = async () => {
    throw new Error("model down")
  }
  it("with an EMPTY catalog + model failure, the fallback is the number-free deterministic play (today)", async () => {
    const d = withCatalog([], [sig("traffic.new_slow_period", "Tuesday afternoons went quiet")])
    const res = await runProducerSkill(guerrillaMarketingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toHaveLength(1)
    // number-free: no dollar/percent figure anywhere in the fallback play
    const text = JSON.stringify(res.plays[0])
    expect(/\$\d|\d+\s?%/.test(text)).toBe(false)
    expect(res.plays[0].leverage?.basisInternal).toContain("ordinally")
    // and it's grounded in the real rule output
    const allowed = buildRefIndex(d).allowedRefs
    expect(res.plays[0].evidenceRefs.every((r) => allowed.has(r))).toBe(true)
  })
  it("a dossier with NO partnerEntities field at all behaves exactly like the empty case (no throw)", async () => {
    const d: Dossier = { ...competitiveWeekDossier, ruleOutputs: [sig("traffic.new_slow_period", "Quiet Tuesdays")] }
    expect(d.partnerEntities).toBeUndefined()
    const res = await runProducerSkill(guerrillaMarketingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toHaveLength(1) // today's number-free fallback, unchanged
  })
  it("with NO grassroots signal at all, even an empty-catalog fallback emits nothing (honesty/zero-play)", async () => {
    const d = withCatalog([partner("Forney High School", "school")], [sig("menu.signature_item_missing")])
    const res = await runProducerSkill(guerrillaMarketingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toEqual([])
  })
})

// ── model-success path end-to-end: a named-anchor play survives run.ts's ground-filter ──
describe("model-success path — a spirit_night naming a real school survives the full run", () => {
  it("a model play anchored on Forney High School + grounded on a real signal survives", async () => {
    const d = withCatalog(
      [partner("Forney High School", "school", { sizeBand: "large" })],
      [sig("traffic.new_slow_period", "Tuesday nights went quiet", {}), sig("menu.price_positioning_shift", "price", { locationAvgPrice: 16 })],
    )
    const modelOutput: Transport = async () => [
      {
        title: "Run a spirit night with Forney High School PTA",
        rationale:
          "Your Tuesday nights run quiet, and Forney High School is 0.8 miles away. A 15-20% donation night their PTA promotes brings their families in to fill the slow window.",
        recipe: [
          {
            channel: "an email + a call to the Forney High School PTA fundraising chair",
            platforms: [],
            audience: "Forney High School families",
            window: { note: "a weeknight 2-3 weeks out so the PTA can promote it" },
            offer: "15-20% of the night's PTA-family sales donated back",
            copy: "Bring this in and 15-20% of your check supports Forney High School.",
            dependencies: ["a flyer/show-this-screen code for attribution"],
          },
        ],
        confidence: "medium",
        stance: "capture",
        leverage: { label: "high", basisInternal: "borrowed PTA distribution; economics scaled from $16 check-avg + large enrollment band" },
        evidenceRefs: ["traffic.new_slow_period"],
      },
    ]
    const res = await runProducerSkill(guerrillaMarketingSkill, d, { transport: modelOutput })
    expect(res.status).toBe("ok")
    expect(res.plays).toHaveLength(1)
    expect(res.plays[0].skillId).toBe("guerrilla-marketing")
    expect(res.plays[0].title).toContain("Forney High School")
    expect(res.plays[0].evidenceRefs).toEqual(["traffic.new_slow_period"])
  })
})
