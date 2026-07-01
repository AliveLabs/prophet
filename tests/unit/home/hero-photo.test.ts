import { describe, it, expect } from "vitest"
import {
  resolvePlayHeroPhoto,
  subjectCompetitorName,
  buildCompetitorCoverMap,
  type HeroPhotoSources,
} from "@/app/(dashboard)/home/hero-photo"
import type { Category, EnrichedRecommendation, PlayPresentation } from "@/lib/skills/types"

// Minimal play — only the fields the resolver reads (category + presentation) matter.
function play(category: Category, presentation?: PlayPresentation): EnrichedRecommendation {
  return {
    title: "t",
    rationale: "r",
    skillId: "s",
    ownerRole: "owner",
    kind: "capitalize",
    recipe: [],
    confidence: "medium",
    evidenceRefs: [],
    knowledgeVersion: "v1",
    category,
    presentation,
  } as unknown as EnrichedRecommendation
}

const OWN = "https://cdn/own-cover.jpg"
const ownLabel = "Testaurant Grill"

describe("resolvePlayHeroPhoto", () => {
  it("social play → the exemplar competitor post image, labeled with the competitor", () => {
    const p = play("social", {
      exemplarSocialPost: {
        competitor: "Joe's Diner",
        platform: "instagram",
        mediaUrl: "https://cdn/joe-post.jpg",
        caption: "",
        source: "social.x",
      },
    })
    const r = resolvePlayHeroPhoto(p, { ownCover: OWN }, ownLabel)
    expect(r).toEqual({ url: "https://cdn/joe-post.jpg", label: "Joe's Diner" })
  })

  it("social play with no exemplar image → falls back to own cover", () => {
    const r = resolvePlayHeroPhoto(play("social"), { ownCover: OWN }, ownLabel)
    expect(r).toEqual({ url: OWN, label: ownLabel })
  })

  it("competitive play → the named competitor's cover (name-normalized match)", () => {
    const p = play("positioning", {
      breakoutQuotes: [{ text: "…", source: "review.x", competitor: "Joe's Diner" }],
    })
    // Stored name differs only by CASE from the play's cited name — both normalize to
    // the same key ("joe s diner"), so the cover still matches (the punctuation-insensitive
    // path is exercised by the shared apostrophe).
    const sources: HeroPhotoSources = {
      ownCover: OWN,
      competitorCovers: buildCompetitorCoverMap([{ name: "JOE'S DINER", url: "https://cdn/joe.jpg" }]),
    }
    const r = resolvePlayHeroPhoto(p, sources, ownLabel)
    expect(r).toEqual({ url: "https://cdn/joe.jpg", label: "Joe's Diner" })
  })

  it("competitive play whose competitor has no cover → falls back to own cover", () => {
    const p = play("positioning", {
      breakoutQuotes: [{ text: "…", source: "review.x", competitor: "Nobody's Cafe" }],
    })
    const sources: HeroPhotoSources = {
      ownCover: OWN,
      competitorCovers: buildCompetitorCoverMap([{ name: "Joe's Diner", url: "https://cdn/joe.jpg" }]),
    }
    expect(resolvePlayHeroPhoto(p, sources, ownLabel)).toEqual({ url: OWN, label: ownLabel })
  })

  it("reputation/menu/other play → own cover with the location label", () => {
    expect(resolvePlayHeroPhoto(play("reputation"), { ownCover: OWN }, ownLabel)).toEqual({ url: OWN, label: ownLabel })
    expect(resolvePlayHeroPhoto(play("menu"), { ownCover: OWN }, ownLabel)).toEqual({ url: OWN, label: ownLabel })
  })

  it("no matched image AND no own cover → null (caller renders the gradient)", () => {
    expect(resolvePlayHeroPhoto(play("reputation"), { ownCover: null }, ownLabel)).toBeNull()
    expect(resolvePlayHeroPhoto(play("positioning"), {}, ownLabel)).toBeNull()
  })
})

describe("subjectCompetitorName", () => {
  it("prefers the exemplar post's competitor, then a quoted competitor, then a head-to-head lead", () => {
    expect(
      subjectCompetitorName(
        play("social", {
          exemplarSocialPost: { competitor: "Exemplar Co", platform: "ig", mediaUrl: "x", caption: "", source: "s" },
          breakoutQuotes: [{ text: "…", source: "r", competitor: "Quoted Co" }],
        }),
      ),
    ).toBe("Exemplar Co")

    expect(
      subjectCompetitorName(play("positioning", { breakoutQuotes: [{ text: "…", source: "r", competitor: "Quoted Co" }] })),
    ).toBe("Quoted Co")

    expect(
      subjectCompetitorName(
        play("positioning", {
          headToHead: [{ metric: "reviews", you: "4.6", setOrCompetitor: "H2H Co", lead: "them", label: "…" }],
        }),
      ),
    ).toBe("H2H Co")
  })

  it("returns null when the play names no competitor", () => {
    expect(subjectCompetitorName(play("reputation"))).toBeNull()
    expect(subjectCompetitorName(play("positioning", { headToHead: [{ metric: "m", you: "1", setOrCompetitor: "the set", lead: "you", label: "l" }] }))).toBeNull()
  })
})
