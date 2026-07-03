// convergence@v2 — the cross-domain convergence strategist (the ninth mastery rewrite).
// REPLACES tests/unit/skills/convergence.test.ts (the v1 suite asserted the @v1 string,
// the severity-BLIND floor, and the first-token domain rule — all deliberately changed).
//
// Pins, mirroring the sibling suites:
//  - wiring: deep pass KEPT, neutral prior, @v2 version, the new learning hook;
//  - signalFamily: the verified family map, incl. the v1 first-token HOLE (three
//    reputation-shaped tokens are ONE family, not three domains);
//  - parse: the >=3-FAMILY grounding gate, the customer-writing kill-list in BOTH
//    directions (ALC-class internal dialogue dies; a genuine owner-voiced combined
//    play survives), the 2-play cap, the stance backstop (maintain never inferred);
//  - floor: severity-gated (all-info 3-family dossiers now yield NOTHING — the v1
//    behavior change), lead-thread-first, number-free, lintVoice-clean, and
//    self-consistent against parse's own gates;
//  - goldens: competitive-week still fires exactly one grounded floor play (on the
//    warning-grade picks); arena/patio/quiet stay silent — the quiet invariant holds;
//  - prompt smoke: worst-case total pinned under the ~34k safe band.

import { describe, it, expect } from "vitest"
import {
  convergenceSkill,
  interleaveByDomain,
  interleaveByFamily,
  signalFamily,
  distinctFamilies,
  isTemplateAdvice,
  CONVERGENCE_ARCHETYPES,
} from "@/lib/skills/convergence/skill"
import { CONVERGENCE_KNOWLEDGE } from "@/lib/skills/convergence/knowledge"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { lintVoice } from "@/lib/eval/voice-rules"
import { extractNumbers } from "@/lib/eval/checks"
import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { BusyTimesResult } from "@/lib/providers/outscraper"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import { patioWeatherDossier } from "@/tests/fixtures/dossiers/patio-weather"
import { quietWeekDossier } from "@/tests/fixtures/dossiers/quiet-week"

const sig = (
  insight_type: string,
  title: string,
  severity: GeneratedInsight["severity"] = "info",
): GeneratedInsight => ({
  insight_type,
  title,
  summary: "a short operator-facing summary",
  confidence: "medium",
  severity,
  evidence: {},
  recommendations: [],
})

const withSignals = (sigs: GeneratedInsight[]): Dossier => ({ ...competitiveWeekDossier, ruleOutputs: sigs })

/** All customer-facing text of a play (what parse's kill-list scans + the honesty gates). */
function playText(p: { title: string; rationale: string; recipe: Array<Record<string, unknown>> }): string {
  return `${p.title} ${p.rationale} ${p.recipe
    .map((s) => `${s.audience ?? ""} ${s.channel ?? ""} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
    .join(" ")}`
}

// ── wiring ────────────────────────────────────────────────────────────────────

describe("convergence@v2 — wiring", () => {
  it("keeps the deep pass + the convergence identity", () => {
    expect(convergenceSkill.id).toBe("convergence")
    expect(convergenceSkill.deep).toBe(true) // the whole-dossier Opus pass IS the mechanism — never demote silently
    expect(convergenceSkill.effort).toBeUndefined() // deep forces high in run.ts; a skill-level override would be dead code
    expect(convergenceSkill.category).toBe("convergence")
    expect(convergenceSkill.tier).toBe("reasoning")
    expect(convergenceSkill.ownerRole).toBe("owner")
    expect(convergenceSkill.kind).toBe("capitalize")
    expect(convergenceSkill.temperature).toBe(0.5)
  })
  it("bumps the knowledge version to convergence@v2 (verified: @v1 is the only prior string)", () => {
    expect(convergenceSkill.knowledgeVersion).toBe("convergence@v2")
  })
  it("keeps the neutral scoring prior (earns the bias from evidence)", () => {
    expect(CATEGORY_PRIORS.convergence).toBe(1.0)
  })
  it("declares the P14 learning hook (v1 was the only skill without one)", () => {
    expect(convergenceSkill.learning).toBeDefined()
    expect(convergenceSkill.learning!.playTypeLeadDomain).toBe("convergence")
    expect(convergenceSkill.learning!.streams).toEqual(expect.arrayContaining(["click", "ask"]))
    expect(convergenceSkill.learning!.acceptedLearningKinds).toEqual(["editorial"])
  })
  it("ships the master playbook (bar tests, ALC anti-pattern, boundaries)", () => {
    expect(convergenceSkill.knowledge).toBe(CONVERGENCE_KNOWLEDGE)
    expect(CONVERGENCE_KNOWLEDGE).toContain("SUBTRACTION TEST")
    expect(CONVERGENCE_KNOWLEDGE).toContain("ALC Dance Studios")
    expect(CONVERGENCE_KNOWLEDGE).toContain("WHAT YOU ARE NOT")
    expect(CONVERGENCE_KNOWLEDGE).toContain("at least three different")
  })
})

describe("convergence@v2 — archetypes (stable learning keys)", () => {
  it("exports 7 unique snake_case combination shapes", () => {
    expect(CONVERGENCE_ARCHETYPES).toHaveLength(7)
    expect(new Set(CONVERGENCE_ARCHETYPES).size).toBe(CONVERGENCE_ARCHETYPES.length)
    for (const key of CONVERGENCE_ARCHETYPES) expect(key).toMatch(/^[a-z]+(_[a-z]+)*$/)
  })
  it("names the flagship shapes", () => {
    expect(CONVERGENCE_ARCHETYPES).toContain("flip_the_reflex")
    expect(CONVERGENCE_ARCHETYPES).toContain("claim_the_dead_zone")
    expect(CONVERGENCE_ARCHETYPES).toContain("triangulate_the_whisper")
  })
})

// ── the family map (the v2 domain gate) ───────────────────────────────────────

describe("signalFamily — verified information channels", () => {
  it("maps every live prefix to its family", () => {
    expect(signalFamily("events.major_lobby_surge")).toBe("demand")
    expect(signalFamily("traffic.baseline")).toBe("traffic")
    expect(signalFamily("traffic.competitive_opportunity")).toBe("traffic")
    expect(signalFamily("hours_changed")).toBe("hours")
    expect(signalFamily("social.engagement_gap")).toBe("social")
    expect(signalFamily("social.cross_seo_opportunity")).toBe("social")
    expect(signalFamily("rating_change")).toBe("reputation")
    expect(signalFamily("review.theme")).toBe("reputation")
    expect(signalFamily("review_themes")).toBe("reputation")
    expect(signalFamily("review_velocity_falling")).toBe("reputation")
    expect(signalFamily("weekly_rating_trend")).toBe("reputation")
    expect(signalFamily("weekly_review_trend")).toBe("reputation")
    expect(signalFamily("menu.category_gap")).toBe("menu")
    expect(signalFamily("photo.price_change")).toBe("menu")
    expect(signalFamily("content.delivery_platform_gap")).toBe("visibility")
    expect(signalFamily("seo_keyword_win")).toBe("visibility")
    expect(signalFamily("cross_event_seo_opportunity")).toBe("visibility")
    expect(signalFamily("visual.category_shift")).toBe("visual")
    expect(signalFamily("visual.professional_upgrade")).toBe("visual")
  })
  it("routes BOTH live weather reads to one weather family (same forecast, no double-count)", () => {
    expect(signalFamily("visual.weather_patio")).toBe("weather")
    expect(signalFamily("traffic.weather_suppression")).toBe("weather")
  })
  it("excludes bookkeeping rows entirely (they can never pad the family count)", () => {
    expect(signalFamily("baseline_snapshot")).toBeNull()
    expect(signalFamily("competitive_summary")).toBeNull()
    expect(signalFamily("no_significant_change")).toBeNull()
    expect(signalFamily("")).toBeNull()
  })
  it("counts unknown FUTURE prefixes as their own family (opportunity ledger / hours rules arm the gate)", () => {
    expect(signalFamily("opportunity.window")).toBe("opportunity")
    expect(signalFamily("hours.competitor_open_gap")).toBe("hours")
  })
  it("strips :field suffixes before mapping", () => {
    expect(signalFamily("menu.category_gap:their_avg")).toBe("menu")
    expect(signalFamily("events.major_lobby_surge:event")).toBe("demand")
  })
})

describe("distinctFamilies — closes the v1 first-token hole", () => {
  it("three reputation-shaped tokens are ONE family, not three domains", () => {
    // v1's domainLabel rule read these as "Weekly"/"Rating"/"Review" = 3 domains — a
    // single-domain play could ship tagged Cross-domain. The family map closes it.
    expect(distinctFamilies(["weekly_rating_trend", "rating_change", "review_velocity_falling"])).toEqual([
      "reputation",
    ])
  })
  it("counts genuinely different channels", () => {
    expect(
      distinctFamilies(["events.major_lobby_surge", "menu.category_gap", "review.theme"]).sort(),
    ).toEqual(["demand", "menu", "reputation"])
  })
  it("ignores bookkeeping refs", () => {
    expect(distinctFamilies(["baseline_snapshot", "no_significant_change", "menu.category_gap"])).toEqual(["menu"])
  })
})

// ── intake interleaving ───────────────────────────────────────────────────────

describe("intake interleaving (P5 finding C, kept and extended)", () => {
  it("interleaveByDomain (v1 back-compat): represents every domain within the cap", () => {
    const make = (dom: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ insight_type: `${dom}.x${i}`, title: "" }))
    const items = [...make("events", 20), ...make("seo", 20), ...make("reviews", 20)]
    const out = interleaveByDomain(items, 40)
    expect(out).toHaveLength(40)
    expect(new Set(out.map((o) => o.insight_type.split(".")[0]))).toEqual(new Set(["events", "seo", "reviews"]))
  })
  it("interleaveByDomain: returns all items when under the cap", () => {
    expect(interleaveByDomain([{ insight_type: "events.a" }, { insight_type: "menu.b" }], 40)).toHaveLength(2)
  })
  it("interleaveByFamily: every family surfaces before any gets seconds", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) => sig(`events.x${i}`, "e")),
      ...Array.from({ length: 20 }, (_, i) => sig(`menu.x${i}`, "m")),
      ...Array.from({ length: 20 }, (_, i) => sig(`social.x${i}`, "s")),
    ]
    const out = interleaveByFamily(items, 30)
    expect(out).toHaveLength(30)
    expect(new Set(out.map((o) => signalFamily(o.insight_type)))).toEqual(new Set(["demand", "menu", "social"]))
  })
  it("interleaveByFamily: bookkeeping rows never waste a slot", () => {
    const items = [sig("baseline_snapshot", "b"), sig("no_significant_change", "n"), sig("menu.a", "m")]
    const out = interleaveByFamily(items, 40)
    expect(out).toHaveLength(1)
    expect(out[0].insight_type).toBe("menu.a")
  })
  it("interleaveByFamily: carries each family's STRONGEST rows first (v1 was severity-blind)", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => sig(`social.info${i}`, "quiet", "info")),
      sig("social.platform_presence_gap", "the loud one", "critical"), // listed LAST in its family
      sig("menu.a", "m", "info"),
    ]
    const out = interleaveByFamily(items, 4)
    // the critical social row must win a slot ahead of the ten earlier info rows
    expect(out.map((o) => o.insight_type)).toContain("social.platform_presence_gap")
    expect(out[0].insight_type).toBe("social.platform_presence_gap") // strongest family first, strongest row first
  })
})

// ── the customer-writing kill-list (backstop, both directions) ────────────────

describe("isTemplateAdvice — internal dialogue / taxonomy / score talk / band misuse", () => {
  it("kills the verbatim ALC anti-pattern (the founder's named failure)", () => {
    expect(
      isTemplateAdvice(
        "ALC Dance Studios is 0.2 miles away, carries a medium enrollment band (40-60 families), and is typed as a school/PTA anchor, so the spirit night vocabulary and mechanics apply directly.",
      ),
    ).toBe(true)
  })
  it("kills each ALC ingredient independently", () => {
    expect(isTemplateAdvice("This business is typed as a school/PTA anchor.")).toBe(true)
    expect(isTemplateAdvice("The studio carries a medium enrollment band.")).toBe(true)
    expect(isTemplateAdvice("It sits in the large size band for gyms.")).toBe(true)
    expect(isTemplateAdvice("The spirit night mechanics apply directly here.")).toBe(true)
  })
  it("kills score/confidence talk and internal taxonomy in customer copy", () => {
    expect(isTemplateAdvice("This is a high-confidence play with a strong impact score.")).toBe(true)
    expect(isTemplateAdvice("Three signals align at high confidence.")).toBe(true)
    expect(isTemplateAdvice("A classic cross-domain synthesis of your signals.")).toBe(true)
    expect(isTemplateAdvice("This convergence of factors qualifies as a strong setup.")).toBe(true)
    expect(isTemplateAdvice("The warning-grade review theme drives this.")).toBe(true)
    expect(isTemplateAdvice("Severity on the traffic signal is elevated.")).toBe(true)
    expect(isTemplateAdvice("Grounded in three evidence refs from your dossier.")).toBe(true)
  })
  it("kills the v1 canned floor title so the model can never parrot it", () => {
    expect(isTemplateAdvice("Line up the threads that move together this week")).toBe(true)
  })
  it("SPARES a literal musical band", () => {
    expect(isTemplateAdvice("Book a live band for Friday night and post a clip of the first song.")).toBe(false)
    expect(isTemplateAdvice("The high school band fundraiser lands Saturday.")).toBe(false)
  })
  it("SPARES genuine owner-voiced combined plays (the strong exemplars)", () => {
    expect(
      isTemplateAdvice(
        "Saturday is set up to pile on you: a street festival two blocks over, the first real patio weather of the season, and your reviews already say service drags when the room is full. Cut the patio menu to your six fastest dishes and prep the top two in advance.",
      ),
    ).toBe(false)
    expect(
      isTemplateAdvice(
        "You are a whisker under the next star on Google, the dish people rave about is your fried chicken, and more people are finding you by searching for exactly that. Stack it: every table that orders the chicken gets a card asking for a review.",
      ),
    ).toBe(false)
  })
})

// ── parse: the family gate + kill-list + cap + stance backstop ────────────────

describe("convergence@v2 — parse", () => {
  const rawPlay = (evidenceRefs: string[], over: Record<string, unknown> = {}) => ({
    title: "One move that answers three shifts at once",
    rationale:
      "A festival lands Friday, your patio weather turns the same day, and reviewers say service drags when the room fills. One trimmed fast menu for that window answers all three.",
    recipe: [{ channel: "in the restaurant", audience: "Friday guests", window: { note: "this week" } }],
    confidence: "medium",
    leverage: { label: "medium", basisInternal: "sized ordinally" },
    evidenceRefs,
    ...over,
  })
  const d3 = withSignals([
    sig("events.weekend_density_spike", "A dense weekend lands", "warning"),
    sig("visual.weather_patio", "Patio weather is coming", "info"),
    sig("review.theme", "Reviewers flag slow service when busy", "warning"),
    sig("menu.category_gap", "A menu gap vs the set", "info"),
  ])

  it("keeps a play citing >=3 refs from >=3 distinct FAMILIES", () => {
    const plays = convergenceSkill.parse(
      [rawPlay(["events.weekend_density_spike", "visual.weather_patio", "review.theme"])],
      d3,
    )
    expect(plays).toHaveLength(1)
    expect(distinctFamilies(plays![0].evidenceRefs).length).toBeGreaterThanOrEqual(3)
  })
  it("drops 3 refs from ONE domain (v1's original finding D)", () => {
    expect(convergenceSkill.parse([rawPlay(["events.a", "events.b", "events.c"])], d3)).toEqual([])
  })
  it("drops the reputation masquerade trio (the v1 first-token HOLE, now closed)", () => {
    expect(
      convergenceSkill.parse([rawPlay(["weekly_rating_trend", "rating_change", "review_velocity_falling"])], d3),
    ).toEqual([])
  })
  it("drops a 2-family play", () => {
    expect(convergenceSkill.parse([rawPlay(["events.a", "events.b", "menu.category_gap"])], d3)).toEqual([])
  })
  it("counts suffixed refs by their base", () => {
    const plays = convergenceSkill.parse(
      [rawPlay(["events.weekend_density_spike:event", "menu.category_gap:items", "review.theme:theme"])],
      d3,
    )
    expect(plays).toHaveLength(1)
  })
  it("caps output at 2 plays, model order kept (one genuine combination beats three forced ones)", () => {
    const plays = convergenceSkill.parse(
      [
        rawPlay(["events.weekend_density_spike", "visual.weather_patio", "review.theme"], { title: "First" }),
        rawPlay(["events.weekend_density_spike", "menu.category_gap", "review.theme"], { title: "Second" }),
        rawPlay(["visual.weather_patio", "menu.category_gap", "review.theme"], { title: "Third" }),
      ],
      d3,
    )
    expect(plays!.map((p) => p.title)).toEqual(["First", "Second"])
  })
  it("suppresses internal-dialogue output even when the refs are genuinely cross-family", () => {
    const plays = convergenceSkill.parse(
      [
        rawPlay(["events.weekend_density_spike", "visual.weather_patio", "review.theme"], {
          rationale:
            "The event signal, weather signal, and review signal all align, so this is typed as a demand-capture play at high confidence.",
        }),
      ],
      d3,
    )
    expect(plays).toEqual([])
  })
  it("returns null on unparseable output (deterministic fallback decides)", () => {
    expect(convergenceSkill.parse("not json at all", d3)).toBeNull()
  })
  it("returns [] (NOT null) on a model that honestly found nothing — the fallback must not overwrite silence", () => {
    expect(convergenceSkill.parse([], d3)).toEqual([])
  })

  describe("stance backstop (maintain never inferred)", () => {
    it("stamps fix when any cited base is warning/critical", () => {
      const plays = convergenceSkill.parse(
        [rawPlay(["events.weekend_density_spike", "visual.weather_patio", "menu.category_gap"])],
        d3, // the events ref is warning-grade in d3
      )
      expect(plays![0].stance).toBe("fix")
    })
    it("stamps capture when every cited base is info-grade", () => {
      const dInfo = withSignals([
        sig("events.weekend_density_spike", "A dense weekend lands", "info"),
        sig("visual.weather_patio", "Patio weather is coming", "info"),
        sig("menu.category_gap", "A menu gap vs the set", "info"),
      ])
      const plays = convergenceSkill.parse(
        [rawPlay(["events.weekend_density_spike", "visual.weather_patio", "menu.category_gap"])],
        dInfo,
      )
      expect(plays![0].stance).toBe("capture")
    })
    it("keeps the model's deliberate stance (incl. maintain — model-chosen only)", () => {
      const kept = convergenceSkill.parse(
        [
          rawPlay(["events.weekend_density_spike", "visual.weather_patio", "review.theme"], { stance: "maintain" }),
          rawPlay(["events.weekend_density_spike", "menu.category_gap", "review.theme"], { stance: "capture" }),
        ],
        d3,
      )
      expect(kept![0].stance).toBe("maintain")
      expect(kept![1].stance).toBe("capture")
    })
  })
})

// ── the honest floor (severity-gated, family-honest, number-free) ─────────────

describe("convergence@v2 — deterministic floor", () => {
  it("emits NOTHING under 3 distinct families", () => {
    expect(convergenceSkill.fallback(withSignals([]))).toEqual([])
    expect(convergenceSkill.fallback(withSignals([sig("events.a", "A", "critical")]))).toEqual([])
    expect(
      convergenceSkill.fallback(
        withSignals([sig("events.a", "A", "warning"), sig("events.b", "B", "warning"), sig("menu.c", "C", "warning")]),
      ),
    ).toEqual([])
  })
  it("emits NOTHING when the reputation masquerade is the only 'variety' (v1 emitted here)", () => {
    expect(
      convergenceSkill.fallback(
        withSignals([
          sig("weekly_rating_trend", "A", "warning"),
          sig("rating_change", "B", "warning"),
          sig("review_velocity_falling", "C", "warning"),
        ]),
      ),
    ).toEqual([])
  })
  it("emits NOTHING on 3 families of pure info-grade signals (the v1 severity hole, closed)", () => {
    expect(
      convergenceSkill.fallback(
        withSignals([
          sig("traffic.baseline", "Your rhythm read", "info"),
          sig("menu.category_gap", "A category gap", "info"),
          sig("social.hashtag_gap", "A hashtag gap", "info"),
        ]),
      ),
    ).toEqual([])
  })
  it("never counts bookkeeping rows toward the family gate", () => {
    expect(
      convergenceSkill.fallback(
        withSignals([
          sig("baseline_snapshot", "Baseline", "info"),
          sig("competitive_summary", "Summary", "info"),
          sig("menu.category_gap", "A gap", "warning"),
        ]),
      ),
    ).toEqual([])
  })

  const firing = withSignals([
    sig("events.weekend_density_spike", "A dense weekend is coming", "warning"),
    sig("menu.category_gap", "Your menu skips a category rivals carry", "info"),
    sig("review.theme", "Reviewers flag slow service when busy", "info"),
  ])

  it("fires exactly ONE play on 3 families with a warning-grade lead", () => {
    const plays = convergenceSkill.fallback(firing)
    expect(plays).toHaveLength(1)
    const p = plays[0]
    expect(p.skillId).toBe("convergence")
    expect(p.kind).toBe("capitalize")
    expect(p.knowledgeVersion).toBe("convergence@v2")
    expect(p.confidence).toBe("directional") // a canned floor has not EARNED medium (v1 over-stamped)
    expect(p.stance).toBe("fix") // cites a live warning thread by construction
    expect(p.evidenceRefs).toHaveLength(3)
    expect(distinctFamilies(p.evidenceRefs)).toHaveLength(3) // parse-consistent: its own gate would pass this play
  })
  it("leads with the load-bearing (strongest) thread", () => {
    const p = convergenceSkill.fallback(firing)[0]
    expect(p.evidenceRefs[0]).toBe("events.weekend_density_spike")
    // the lead thread is NAMED FIRST in the rationale
    const leadIdx = p.rationale.indexOf("A dense weekend is coming")
    expect(leadIdx).toBeGreaterThan(-1)
    expect(leadIdx).toBeLessThan(p.rationale.indexOf("Your menu skips a category rivals carry"))
  })
  it("picks the strongest signal per family (critical beats warning beats info)", () => {
    const d = withSignals([
      sig("social.hashtag_gap", "A hashtag gap", "info"),
      sig("social.platform_presence_gap", "A ceded platform", "critical"),
      sig("menu.category_gap", "A category gap", "warning"),
      sig("review.theme", "A complaint theme", "info"),
    ])
    const p = convergenceSkill.fallback(d)[0]
    expect(p.evidenceRefs[0]).toBe("social.platform_presence_gap") // critical leads
    expect(p.evidenceRefs).toContain("menu.category_gap")
    expect(p.evidenceRefs).not.toContain("social.hashtag_gap") // one pick per family, strongest wins
  })
  it("floor copy is number-free, voice-clean, and survives its own kill-list", () => {
    const p = convergenceSkill.fallback(firing)[0]
    const text = playText(p as never)
    expect(extractNumbers(text)).toEqual([])
    expect(lintVoice(p.title)).toEqual([])
    expect(lintVoice(p.rationale)).toEqual([])
    expect(isTemplateAdvice(text)).toBe(false) // self-consistency: parse would not kill the floor's own play
  })
})

// ── golden implications (the four real fixtures) ──────────────────────────────

describe("convergence@v2 — goldens (deterministic floor over the real fixtures)", () => {
  it("competitive-week: fires exactly one grounded play on the warning-grade picks", () => {
    const plays = convergenceSkill.fallback(competitiveWeekDossier)
    expect(plays).toHaveLength(1)
    const p = plays[0]
    // strongest per family: social -> posting_frequency_gap (warning beats info),
    // reputation -> review.theme (warning beats info), menu -> price_positioning_shift.
    expect([...p.evidenceRefs].sort()).toEqual([
      "menu.price_positioning_shift",
      "review.theme",
      "social.posting_frequency_gap",
    ])
    const index = buildRefIndex(competitiveWeekDossier)
    expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
    expect(lintVoice(p.title)).toEqual([])
    expect(lintVoice(p.rationale)).toEqual([])
  })
  it("arena-week: silent (two families is not a combination)", () => {
    expect(convergenceSkill.fallback(arenaWeekDossier)).toEqual([])
  })
  it("patio-weather: silent (one family)", () => {
    expect(convergenceSkill.fallback(patioWeatherDossier)).toEqual([])
  })
  it("quiet-week: silent — the honest quiet brief invariant holds", () => {
    expect(convergenceSkill.fallback(quietWeekDossier)).toEqual([])
  })
})

// ── prompt smoke (deep pass; the ~34k safe band) ──────────────────────────────

describe("convergence@v2 — buildPrompt smoke", () => {
  it("bare dossier: compact prompt, playbook present", () => {
    const { systemCached = "", system, prompt } = convergenceSkill.buildPrompt(quietWeekDossier)
    expect(systemCached).toContain("SUBTRACTION TEST")
    expect(systemCached).toContain("ALC Dance Studios")
    const total = systemCached.length + system.length + prompt.length
    console.log(`[smoke] bare prompt chars: system=${systemCached.length + system.length} user=${prompt.length} total=${total}`)
    expect(total).toBeLessThan(34_000)
  })

  it("rich dossier (fat signals + full curves + events + themes + rival curves): stays under the band", () => {
    const longSummary =
      "A deliberately long generator summary that would eat the deep-pass token budget if passed raw, repeated across dozens of rows to simulate a fat production dossier where every family fired this week and each row carries full prose. ".repeat(2)
    const fams = ["events.", "traffic.", "social.", "menu.", "content.", "photo.", "rating_", "hours_"]
    const fatSignals: GeneratedInsight[] = Array.from({ length: 44 }, (_, i) => ({
      ...sig(`${fams[i % fams.length]}x${i}`, `Signal ${String.fromCharCode(65 + (i % 26))} title with detail`, i % 3 === 0 ? "warning" : "info"),
      summary: longSummary,
      // HONEST allowedRefs load: real rule rows carry evidence keys, and every key
      // becomes a `type:key` entry in allowedEvidenceRefs — the part of the prompt
      // no skill controls. 44 types x 3 keys ≈ 176 ref lines.
      evidence: { first_key: 12, second_key: "a value", third_key: true },
    }))
    const busy: BusyTimesResult = {
      competitor_id: "own",
      days: Array.from({ length: 7 }, (_, d) => ({
        day_of_week: d,
        day_name: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d],
        hourly_scores: Array.from({ length: 24 }, (_, h) => (h * 7 + d) % 100),
        peak_hour: 19,
        peak_score: 96,
        slow_hours: [14, 15, 16],
      })),
      typical_time_spent: "45-90 min",
      current_popularity: 40,
      working_hours_lines: ["Mon: 11AM-10PM"],
    }
    const rich: Dossier = {
      ...competitiveWeekDossier,
      ruleOutputs: fatSignals,
      location: {
        ...competitiveWeekDossier.location,
        busyTimes: busy,
        reviews: {
          source: "outscraper",
          windowDays: 90,
          themes: Array.from({ length: 8 }, (_, i) => ({
            theme: `theme-${i}`,
            sentiment: "negative" as const,
            mentions: 5,
            examples: [longSummary, longSummary, longSummary],
          })),
        },
      },
      // T3 simulated LIVE at tier-2 width: FIVE rivals with populated curves.
      competitors: Array.from({ length: 5 }, (_, i) => ({
        entityId: `comp-${i}`,
        kind: "competitor" as const,
        name: `Rival Number ${i} With A Long Name`,
        busyTimes: busy,
      })),
      demandCalendar: {
        events: Array.from({ length: 6 }, (_, i) => ({
          uid: `ev-${i}`,
          title: `Event ${i} with a reasonably long public title`,
          description: longSummary,
          startDatetime: "2026-07-04T19:00:00Z",
          displayedDates: "Jul 4",
          venue: { name: `Venue ${i}`, address: "123 Main St, Atlanta GA" },
          distanceMiles: 0.4,
          magnitude: "major" as const,
          role: "local_foot" as const,
          capacityLow: 1000,
          capacityHigh: 2000,
          source: "dataforseo_google_events" as const,
          keyword: "events near me",
          dateRange: "next 7 days",
        })),
        weather: Array.from({ length: 4 }, (_, i) => ({
          date: `2026-07-0${i + 1}`,
          temp_high_f: 91,
          temp_low_f: 72,
          feels_like_high_f: 95,
          humidity_avg: 60,
          wind_speed_max_mph: 8,
          weather_condition: "Clear",
          weather_description: "clear sky with a hot afternoon",
          weather_icon: "01d",
          precipitation_in: 0,
          is_severe: false,
        })),
      },
    }
    const { systemCached = "", system, prompt } = convergenceSkill.buildPrompt(rich)
    const total = systemCached.length + system.length + prompt.length
    console.log(`[smoke] rich prompt chars: system=${systemCached.length + system.length} user=${prompt.length} total=${total}`)
    expect(total).toBeLessThan(34_000)
    // The trims actually happened: raw summaries truncated, curves at window grain,
    // event descriptions not passed, rival curves PRESENT (the T3 arming proof).
    expect(prompt).not.toContain(longSummary)
    expect(prompt).not.toContain("hourly_scores")
    expect(prompt).toContain("competitorBusyTimes")
    expect(prompt).toContain("[warning|") // severity+family markers visible (v1 hid severity from the model)
  })
})
