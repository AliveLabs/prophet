import { describe, it, expect } from "vitest"
import { pickCoverPhoto, pickCoverPhotoWithFocal, type PhotoRow } from "@/lib/places/listing-audit"

// Beta report 2026-08-17: a customer-uploaded shot of a GameStop interior was rendering as
// the cover for a Subway. Root cause was that an UNANALYSED photo scored 0 and was still
// eligible, and `best` was seeded by the first row regardless of score — so position in the
// array decided a competitor's headline image.
//
// The rule now is positive evidence: we show a cover only when we can say what it is.

const analysis = (over: Record<string, unknown> = {}) => ({
  category: "food_dish",
  subcategory: "",
  tags: [],
  extracted_text: "",
  promotional_content: false,
  promotional_details: "",
  quality_signals: { lighting: "professional", staging: "styled" },
  confidence: 0.9,
  ...over,
})

describe("pickCoverPhotoWithFocal — eligibility", () => {
  it("returns null when NOTHING has been analysed yet (first-run partial data)", () => {
    const rows: PhotoRow[] = [
      { image_url: "https://x/1.jpg", analysis_result: null },
      { image_url: "https://x/2.jpg", analysis_result: null },
    ]
    expect(pickCoverPhoto(rows)).toBeNull()
  })

  it("never lets an unanalysed photo win by being FIRST in the array", () => {
    const rows: PhotoRow[] = [
      { image_url: "https://x/unknown.jpg", analysis_result: null },
      { image_url: "https://x/good.jpg", analysis_result: analysis() },
    ]
    expect(pickCoverPhoto(rows)).toBe("https://x/good.jpg")
  })

  it("excludes categories that map to no listing slot, even at high confidence", () => {
    // `other` is what a photo from an entirely different business tends to land on.
    for (const category of ["other", "event_promotion", "renovation", "seasonal_decor", "customer_atmosphere"]) {
      const rows: PhotoRow[] = [{ image_url: "https://x/a.jpg", analysis_result: analysis({ category }) }]
      expect(pickCoverPhoto(rows)).toBeNull()
    }
  })

  it("excludes promotional images — a flyer is a message, not a portrait", () => {
    const rows: PhotoRow[] = [
      { image_url: "https://x/flyer.jpg", analysis_result: analysis({ promotional_content: true }) },
    ]
    expect(pickCoverPhoto(rows)).toBeNull()
  })

  it("drops a read below the confidence floor rather than trusting it", () => {
    const rows: PhotoRow[] = [
      { image_url: "https://x/unsure.jpg", analysis_result: analysis({ confidence: 0.2 }) },
    ]
    expect(pickCoverPhoto(rows)).toBeNull()
  })
})

describe("pickCoverPhotoWithFocal — ranking among eligible photos", () => {
  it("prefers the higher-priority slot", () => {
    const rows: PhotoRow[] = [
      { image_url: "https://x/staff.jpg", analysis_result: analysis({ category: "staff_team" }) },
      { image_url: "https://x/dish.jpg", analysis_result: analysis({ category: "food_dish" }) },
    ]
    expect(pickCoverPhoto(rows)).toBe("https://x/dish.jpg")
  })

  it("breaks ties within a slot on quality", () => {
    const rows: PhotoRow[] = [
      {
        image_url: "https://x/amateur.jpg",
        analysis_result: analysis({ quality_signals: { lighting: "amateur", staging: "candid" } }),
      },
      { image_url: "https://x/pro.jpg", analysis_result: analysis() },
    ]
    expect(pickCoverPhoto(rows)).toBe("https://x/pro.jpg")
  })

  it("carries the focal point through, defaulting to centre when absent", () => {
    const withFocal: PhotoRow[] = [
      { image_url: "https://x/a.jpg", analysis_result: analysis({ focal_point: { x: 0.2, y: 0.8 } }) },
    ]
    expect(pickCoverPhotoWithFocal(withFocal)?.focal).toEqual({ x: 0.2, y: 0.8 })

    const noFocal: PhotoRow[] = [{ image_url: "https://x/b.jpg", analysis_result: analysis() }]
    expect(pickCoverPhotoWithFocal(noFocal)?.focal).toEqual({ x: 0.5, y: 0.5 })
  })

  it("ignores rows with no image url", () => {
    const rows: PhotoRow[] = [
      { image_url: "", analysis_result: analysis() },
      { image_url: "https://x/real.jpg", analysis_result: analysis({ category: "interior" }) },
    ]
    expect(pickCoverPhoto(rows)).toBe("https://x/real.jpg")
  })
})
