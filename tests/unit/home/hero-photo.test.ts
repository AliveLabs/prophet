import { describe, it, expect } from "vitest"
import {
  resolvePlayHeroPhoto,
  subjectCompetitorName,
  buildCompetitorCoverMap,
  type HeroPhotoSources,
} from "@/app/(dashboard)/home/hero-photo"
import type { PhotoRow } from "@/lib/places/listing-audit"
import type { PhotoCategory, FocalPoint } from "@/lib/providers/photos"
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
// `focal` is stored on the analysis when provided; omitted → the resolver defaults to center.
function ownRow(category: PhotoCategory, url: string, focal?: FocalPoint): PhotoRow {
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
      ...(focal ? { focal_point: focal } : {}),
    },
  }
}

const FOOD = "https://cdn/food.jpg"
const INTERIOR = "https://cdn/interior.jpg"
const EXTERIOR = "https://cdn/exterior.jpg"
const STAFF = "https://cdn/staff.jpg"
const CENTER: FocalPoint = { x: 0.5, y: 0.5 }
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
    expect(resolvePlayHeroPhoto(p, { ownPhotos: [ownRow("food_dish", FOOD)] }, ownLabel)).toEqual({
      url: "https://cdn/joe-post.jpg",
      label: "Joe's Diner",
      focal: CENTER,
    })
  })

  it("carries the exemplar post's focal point through when present", () => {
    const p = play("social", {
      exemplarSocialPost: {
        competitor: "Joe's Diner",
        platform: "instagram",
        mediaUrl: "https://cdn/joe-post.jpg",
        caption: "",
        source: "social.x",
        focalPoint: { x: 0.3, y: 0.75 },
      },
    })
    expect(resolvePlayHeroPhoto(p, {}, ownLabel)?.focal).toEqual({ x: 0.3, y: 0.75 })
  })

  it("social play with no exemplar → a category-matched own photo (center focal by default)", () => {
    expect(resolvePlayHeroPhoto(play("social"), { ownPhotos: [ownRow("food_dish", FOOD)] }, ownLabel)).toEqual({
      url: FOOD,
      label: ownLabel,
      focal: CENTER,
    })
  })

  it("uses the chosen own photo's stored focal point", () => {
    const r = resolvePlayHeroPhoto(play("menu"), { ownPhotos: [ownRow("food_dish", FOOD, { x: 0.25, y: 0.8 })] }, ownLabel)
    expect(r).toEqual({ url: FOOD, label: ownLabel, focal: { x: 0.25, y: 0.8 } })
  })

  it("competitive play → the named competitor's cover + its focal (name-normalized match)", () => {
    const p = play("positioning", {
      breakoutQuotes: [{ text: "…", source: "review.x", competitor: "Joe's Diner" }],
    })
    const sources: HeroPhotoSources = {
      ownPhotos: [ownRow("exterior", EXTERIOR)],
      competitorCovers: buildCompetitorCoverMap([{ name: "JOE'S DINER", url: "https://cdn/joe.jpg", focal: { x: 0.2, y: 0.4 } }]),
    }
    expect(resolvePlayHeroPhoto(p, sources, ownLabel)).toEqual({
      url: "https://cdn/joe.jpg",
      label: "Joe's Diner",
      focal: { x: 0.2, y: 0.4 },
    })
  })

  it("competitive play whose competitor has no cover → own photo (exterior preferred)", () => {
    const p = play("positioning", {
      breakoutQuotes: [{ text: "…", source: "review.x", competitor: "Nobody's Cafe" }],
    })
    const sources: HeroPhotoSources = {
      ownPhotos: [ownRow("interior", INTERIOR), ownRow("exterior", EXTERIOR)],
      competitorCovers: buildCompetitorCoverMap([{ name: "Joe's Diner", url: "https://cdn/joe.jpg", focal: CENTER }]),
    }
    expect(resolvePlayHeroPhoto(p, sources, ownLabel)).toEqual({ url: EXTERIOR, label: ownLabel, focal: CENTER })
  })

  it("varies the own photo by insight family (fixes the repeated-cover problem)", () => {
    const ownPhotos = [ownRow("interior", INTERIOR), ownRow("food_dish", FOOD)]
    expect(resolvePlayHeroPhoto(play("menu"), { ownPhotos }, ownLabel)?.url).toBe(FOOD)
    expect(resolvePlayHeroPhoto(play("reputation"), { ownPhotos }, ownLabel)?.url).toBe(INTERIOR)
  })

  it("falls back to the best overall photo when nothing matches the family's categories", () => {
    expect(resolvePlayHeroPhoto(play("menu"), { ownPhotos: [ownRow("staff_team", STAFF)] }, ownLabel)).toEqual({
      url: STAFF,
      label: ownLabel,
      focal: CENTER,
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
