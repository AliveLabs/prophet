// PRETEST (Bryan's idea, 2026-06-09): before building event geo-relevance gates, run a
// far-event scenario through the EXISTING skills and observe what they produce —
// variant A mirrors today's reality (no distance data, generic profile), variant B adds
// distance + service model to the DATA only (no prompt changes) to measure how much the
// model self-gates when it can see geography. The delta tunes how hard the built gates
// must be. Run: set -a; . ./.env.local; set +a; npx vitest run --config vitest.integration.config.ts tests/integration/pretest-event-geo.live.test.ts
import { describe, it, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import type { NormalizedEvent } from "@/lib/events/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import { runBrief } from "@/lib/skills/pipeline"

type LooseEvent = NormalizedEvent & Record<string, unknown>

function ev(o: Record<string, unknown>): LooseEvent {
  return {
    uid: String(o.uid),
    title: String(o.title),
    startDatetime: "2026-06-13T19:30:00-05:00",
    venue: o.venue as NormalizedEvent["venue"],
    ticketsAndInfo: (o.tickets as NormalizedEvent["ticketsAndInfo"]) ?? [],
    source: "dataforseo_google_events",
    keyword: "events",
    dateRange: "week",
    ...o,
  } as LooseEvent
}

function buildDossierVariant(withGeo: boolean): Dossier {
  const events: LooseEvent[] = [
    ev({
      uid: "evt-mavs",
      title: "Dallas Mavericks Playoff Game 4",
      venue: { name: "American Airlines Center", address: "2500 Victory Ave, Dallas, TX" },
      tickets: [{ title: "TICKETS", domain: "ticketmaster.com" }, { title: "TICKETS", domain: "nba.com" }],
      ...(withGeo ? { distanceMiles: 22.4, magnitude: "major", attendanceEstimate: 19200 } : {}),
    }),
    ev({
      uid: "evt-comedy",
      title: "Misfits Comedy Tour",
      venue: { name: "Jax Comedy House", address: "316 S Goliad St, Rockwall, TX" },
      ...(withGeo ? { distanceMiles: 11.2, magnitude: "minor", attendanceEstimate: 150 } : {}),
    }),
    ev({
      uid: "evt-juneteenth",
      title: "BSW Juneteenth Festival",
      venue: { name: "Lancaster Community Park", address: "1700 Veterans Memorial Pkwy, Lancaster, TX" },
      ...(withGeo ? { distanceMiles: 24.8, magnitude: "moderate", attendanceEstimate: 3000 } : {}),
    }),
    ev({
      uid: "evt-market",
      title: "Forney Farmers Market",
      venue: { name: "Downtown Forney", address: "101 E Main St, Forney, TX" },
      ...(withGeo ? { distanceMiles: 0.9, magnitude: "minor", attendanceEstimate: 400 } : {}),
    }),
  ]

  const ruleOutputs: GeneratedInsight[] = [
    {
      insight_type: "events.new_high_signal_event",
      title: "4 events nearby this week",
      summary: "Multiple ticketed events in the area this week, led by a major NBA playoff game.",
      confidence: "high",
      severity: "info",
      evidence: { totalEvents: 4, top: "Dallas Mavericks Playoff Game 4" },
      recommendations: [{ title: "Prepare for increased demand", rationale: "More events nearby may drive foot traffic." }],
    },
  ]

  return {
    locationId: "loc-bushs",
    dateKey: "2026-06-12",
    generatedAt: "2026-06-12T06:02:00-05:00",
    tier: TIER_CAPS[1],
    profile: {
      locationId: "loc-bushs",
      name: "Bush's Chicken Forney",
      timezone: "America/Chicago",
      voiceTone: "casual",
      attributes: withGeo
        ? { cuisine: "fried chicken", priceTier: "value", serviceModel: "drive-thru quick service", hasPatio: false, dayparts: ["lunch", "dinner"] }
        : {},
      capability: { whoRunsMarketing: "owner", liveChannels: ["facebook"], marketingBudgetBand: "low" },
    },
    location: { entityId: "loc-bushs", kind: "location", name: "Bush's Chicken Forney" },
    competitors: [
      { entityId: "comp-cfa", kind: "competitor", name: "Chick-fil-A Forney" },
      { entityId: "comp-canes", kind: "competitor", name: "Raising Cane's Forney" },
    ],
    demandCalendar: { events: events as NormalizedEvent[], weather: [] },
    ruleOutputs,
  } as Dossier
}

function summarize(label: string, brief: { headline: string; plays: Array<{ title: string; kind: string; confidence: string; evidenceRefs: string[]; leverage?: { label: string } | null }> }) {
  console.log(`\n========== ${label} ==========`)
  console.log(`HEADLINE: ${brief.headline}`)
  for (const p of brief.plays) {
    console.log(`  [${p.kind}/${p.confidence}/${p.leverage?.label ?? "-"}] ${p.title}`)
    console.log(`      refs: ${p.evidenceRefs.join(", ")}`)
  }
}

function buildDossierVariantC(): Dossier {
  // The POST-BUILD shape: role-split channels exactly as buildDossier now produces them.
  const base = buildDossierVariant(true)
  const all = base.demandCalendar.events as LooseEvent[]
  const local = all.filter((e) => (e.distanceMiles as number) <= 3)
  const hooks = all.filter((e) => (e.distanceMiles as number) > 3 && e.uid === "evt-mavs")
  for (const e of local) e.role = (e.distanceMiles as number) <= 0.5 ? "local_foot" : "local_traffic"
  for (const e of hooks) e.role = "metro_hook"
  return {
    ...base,
    demandCalendar: { events: local as NormalizedEvent[], metroHooks: hooks as NormalizedEvent[], weather: [] },
    // rule outputs re-gated: only local events ground "nearby" insights now
    ruleOutputs: [
      {
        insight_type: "events.new_high_signal_event",
        title: "Forney Farmers Market Saturday, blocks away",
        summary: "A small local market runs Saturday morning within a mile of the restaurant.",
        confidence: "high",
        severity: "info",
        evidence: { totalEvents: 1, top: "Forney Farmers Market", distance_mi: 0.9 },
        recommendations: [],
      },
    ],
  }
}

describe("PRETEST: existing skills vs far-event scenario", () => {
  it("variant A — today's reality (no distance data)", async () => {
    const { brief, dropped } = await runBrief(buildDossierVariant(false))
    summarize("VARIANT A (no geo data — current prod behavior)", brief)
    console.log(`dropped by review: ${dropped.length}`)
    expect(brief).toBeTruthy()
  }, 600_000)

  it("variant B — distance + service model in DATA only (no prompt changes)", async () => {
    const { brief, dropped } = await runBrief(buildDossierVariant(true))
    summarize("VARIANT B (geo data present, prompts unchanged)", brief)
    console.log(`dropped by review: ${dropped.length}`)
    expect(brief).toBeTruthy()
  }, 600_000)

  it("variant C — THE BUILT GATES: role-split channels + new prompts", async () => {
    const { brief, dropped } = await runBrief(buildDossierVariantC())
    summarize("VARIANT C (structural gates + EVENT_GEOGRAPHY prompts)", brief)
    console.log(`dropped by review: ${dropped.length}`)
    // hard assertions: no staffing/prep play may reference the far-away Mavs game
    const mavsDemand = brief.plays.filter(
      (p) => /mav|playoff|pre-game|post-game/i.test(`${p.title} ${p.rationale}`) && (p.kind === "prepare" || p.kind === "ops")
    )
    expect(mavsDemand, `Mavs demand plays should be ZERO, got: ${mavsDemand.map((p) => p.title).join("; ")}`).toEqual([])
    // any Mavs tie-in must be low/medium leverage
    for (const p of brief.plays) {
      if (/mav|playoff/i.test(`${p.title} ${p.rationale}`)) {
        expect(p.leverage?.label, `Mavs tie-in must not be high leverage: ${p.title}`).not.toBe("high")
      }
    }
    expect(brief).toBeTruthy()
  }, 600_000)
})
