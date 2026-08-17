// ALT-623 — a card titled "local search" may only show searches that are local.
//
// The bug: the first-run card showed the operator's three best-ranked keywords, picked purely by
// position. Ranked keywords come back for the whole domain, so the top three are usually the brand
// name and broad category terms. The first operator to see it said the pills were "not related to
// my area". They were right.

import { describe, it, expect } from "vitest"
import {
  isLocalKeyword,
  pickLocalKeywords,
  placeNamesFor,
  localKeywordLabel,
} from "@/lib/seo/local-keywords"

const FORNEY = { city: "Forney", region: "Texas", postalCode: "75126" }

describe("isLocalKeyword", () => {
  it("accepts a keyword naming the city", () => {
    expect(isLocalKeyword("best tacos forney", FORNEY)).toBe(true)
    expect(isLocalKeyword("FORNEY steakhouse", FORNEY)).toBe(true)
  })

  it("accepts the full state name and the postal code", () => {
    expect(isLocalKeyword("bbq texas", FORNEY)).toBe(true)
    expect(isLocalKeyword("pizza 75126", FORNEY)).toBe(true)
  })

  it("accepts explicit near-me intent with no place named", () => {
    for (const k of ["tacos near me", "steakhouse nearby", "brunch around me", "bbq near by"]) {
      expect(isLocalKeyword(k, FORNEY), k).toBe(true)
    }
  })

  it("REJECTS the national terms that used to fill the card", () => {
    for (const k of ["best tacos", "taco recipe", "mexican food", "restaurant near", "tacos"]) {
      expect(isLocalKeyword(k, FORNEY), k).toBe(false)
    }
  })

  it("does not match a city name inside a longer word", () => {
    // Word boundaries, not substrings: "Forney" must not match "forneyville" for a different town.
    expect(isLocalKeyword("forneyville diner", FORNEY)).toBe(false)
  })

  it("never matches a two-letter state code, because those are ordinary English", () => {
    // "in" (Indiana), "or" (Oregon), "me" (Maine), "hi", "ok", "de", "la", "pa" are all state
    // codes AND common words. Matching them would mark almost every keyword local.
    const indiana = { city: "Muncie", region: "IN" }
    expect(isLocalKeyword("best pizza in town", indiana)).toBe(false)
    expect(isLocalKeyword("pizza or pasta", { city: "Bend", region: "OR" })).toBe(false)
  })

  it("ignores a country-level 'place' that would match everything", () => {
    expect(placeNamesFor({ city: "USA", region: "United States" })).toEqual([])
  })

  it("survives an empty or whitespace keyword", () => {
    expect(isLocalKeyword("", FORNEY)).toBe(false)
    expect(isLocalKeyword("   ", FORNEY)).toBe(false)
  })

  it("returns false rather than matching everything when we know no geography", () => {
    expect(isLocalKeyword("best tacos forney", {})).toBe(false)
    // Near-me intent still stands on its own: it is local without naming a place.
    expect(isLocalKeyword("tacos near me", {})).toBe(true)
  })

  it("matches a supplied neighborhood", () => {
    expect(isLocalKeyword("deep ellum brunch", { city: "Dallas", extraPlaces: ["Deep Ellum"] })).toBe(true)
  })
})

describe("pickLocalKeywords", () => {
  const keywords = [
    { keyword: "best tacos", rank: 1 },
    { keyword: "taco recipe", rank: 2 },
    { keyword: "tacos forney", rank: 9 },
    { keyword: "tacos near me", rank: 4 },
    { keyword: "mexican food 75126", rank: 22 },
    { keyword: "mexican food", rank: 3 },
  ]

  it("returns only local searches, best position first", () => {
    expect(pickLocalKeywords(keywords, FORNEY)).toEqual([
      { keyword: "tacos near me", rank: 4 },
      { keyword: "tacos forney", rank: 9 },
      { keyword: "mexican food 75126", rank: 22 },
    ])
  })

  it("does NOT pad with national terms to reach the limit", () => {
    // The old bug in one assertion: rank 1 and 2 are the best-ranked keywords and neither is local,
    // so neither may appear. Two local results is the honest answer.
    const picked = pickLocalKeywords(keywords.slice(0, 4), FORNEY)
    expect(picked.map((k) => k.keyword)).toEqual(["tacos near me", "tacos forney"])
  })

  it("returns empty when nothing is local, rather than a best-effort guess", () => {
    expect(pickLocalKeywords([{ keyword: "best tacos", rank: 1 }], FORNEY)).toEqual([])
  })

  it("sorts an unranked keyword last instead of treating it as position zero", () => {
    const picked = pickLocalKeywords(
      [{ keyword: "tacos forney", rank: null }, { keyword: "tacos near me", rank: 30 }],
      FORNEY,
    )
    expect(picked[0].keyword).toBe("tacos near me")
  })

  it("honours the limit", () => {
    expect(pickLocalKeywords(keywords, FORNEY, 1)).toHaveLength(1)
  })
})

describe("localKeywordLabel", () => {
  it("carries the position, so the pill says something on its own", () => {
    expect(localKeywordLabel({ keyword: "tacos forney", rank: 3 })).toBe("“tacos forney”, position 3")
  })

  it("omits a position we do not have rather than inventing one", () => {
    expect(localKeywordLabel({ keyword: "tacos forney", rank: null })).toBe("“tacos forney”")
    expect(localKeywordLabel({ keyword: "tacos forney", rank: 0 })).toBe("“tacos forney”")
  })
})
