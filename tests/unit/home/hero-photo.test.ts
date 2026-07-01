import { describe, it, expect } from "vitest"
import {
  resolvePlayHeroPhoto,
  subjectCompetitorName,
  buildCompetitorCoverMap,
  type HeroPhotoSources,
} from "@/app/(dashboard)/home/hero-photo"
import type { PhotoRow } from "@/lib/places/listing-audit"
import type { PhotoCategory } from "@/lib/providers/photos"
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

// An own-listing photo row with a given category + url (professional/styled so it scores).
function ownRow(category: PhotoCategory, url: string): PhotoRow {
  return {
    image_url: url,
    analysis_result: {
      category,
      subcategory: "",
      tags: [],
      extracted_text: "",
      promotional_content: false,
      promotional_details: "",
      quality_signals: { lighting: "professional", staging: "styled" },
      confidence: 0.9,
      notable_changes: "",
    },
  }
}

const FOOD = "https://cdn/food.jpg"
const INTERIOR = "https://cdn/interior.jpg"
const EXTERIOR = "https://cdn/exterior.jpg"
const STAFF = "https://cdn/staff.jpg"
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
    const r = resolvePlayHeroPhoto(p, { ownPhotos: [ownRow("food_dish", FOOD)] }, ownLabel)
    expect(r).toEqual({ url: "https://cdn/joe-post.jpg", label: "Joe's Diner" })
  })

  it("social play with no exemplar → falls back to a category-matched own photo", () => {
    const r = resolvePlayHeroPhoto(play("social"), { ownPhotos: [ownRow("food_dish", FOOD)] }, ownLabel)
    expect(r).toEqual({ url: FOOD, label: ownLabel })
  })

  it("competitive play → the named competitor's cover (name-normalized match)", () => {
    const p = play("positioning", {
      breakoutQuotes: [{ text: "…", source: "review.x", competitor: "Joe's Diner" }],
    })
    // Stored name differs only by CASE from the cited name — both normalize to "joe s diner".
    const sources: HeroPhotoSources = {
      ownPhotos: [ownRow("exterior", EXTERIOR)],
      competitorCovers: buildCompetitorCoverMap([{ name: "JOE'S DINER", url: "https://cdn/joe.jpg" }]),
    }
    expect(resolvePlayHeroPhoto(p, sources, ownLabel)).toEqual({ url: "https://cdn/joe.jpg", label: "Joe's Diner" })
  })

  it("competitive play whose competitor has no cover → own photo (exterior preferred)", () => {
    const p = play("positioning", {
      breakoutQuotes: [{ text: "…", source: "review.x", competitor: "Nobody's Cafe" }],
    })
    const sources: HeroPhotoSources = {
      ownPhotos: [ownRow("interior", INTERIOR), ownRow("exterior", EXTERIOR)],
      competitorCovers: buildCompetitorCoverMap([{ name: "Joe's Diner", url: "https://cdn/joe.jpg" }]),
    }
    // competitive prefers exterior first → EXTERIOR, not the interior shot.
    expect(resolvePlayHeroPhoto(p, sources, ownLabel)).toEqual({ url: EXTERIOR, label: ownLabel })
  })

  it("varies the own photo by insight family (fixes the repeated-cover problem)", () => {
    const ownPhotos = [ownRow("interior", INTERIOR), ownRow("food_dish", FOOD)]
    // menu wants food first; reputation wants interior/atmosphere first — same photos, different pick.
    expect(resolvePlayHeroPhoto(play("menu"), { ownPhotos }, ownLabel)).toEqual({ url: FOOD, label: ownLabel })
    expect(resolvePlayHeroPhoto(play("reputation"), { ownPhotos }, ownLabel)).toEqual({ url: INTERIOR, label: ownLabel })
  })

  it("falls back to the best overall photo when nothing matches the family's categories", () => {
    // menu prefers [food_dish, menu_board]; only a staff photo exists → still shows it, not nothing.
    expect(resolvePlayHeroPhoto(play("menu"), { ownPhotos: [ownRow("staff_team", STAFF)] }, ownLabel)).toEqual({
      url: STAFF,
      label: ownLabel,
    })
  })

  it("no own photos AND no competitor match → null (caller renders the gradient)", () => {
    expect(resolvePlayHeroPhoto(play("reputation"), { ownPhotos: [] }, ownLabel)).toBeNull()
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
