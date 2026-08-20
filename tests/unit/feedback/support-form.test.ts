import { describe, it, expect } from "vitest"
import {
  SUPPORT_SUBJECTS,
  FEEDBACK_SUBJECTS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  SIGNIN_SUBJECTS,
  SIGNIN_SUBJECT_LABELS,
  normalizeCategory,
  normalizeEmail,
  normalizeBusinessName,
  normalizeMessage,
  isSigninSubject,
  referenceFor,
} from "@/lib/feedback/feedback"

// ALT-695. Two doors, one queue: the authed "Help" launcher and the logged-out sign-in form share
// this vocabulary, the validation and the reference id, and share no component.

describe("the subject vocabulary stays backward compatible", () => {
  it("keeps the four original feedback values EXACTLY", () => {
    // 8 production rows already carry `issue`, `idea` and null. Widening a union is safe;
    // renaming a value would orphan those rows and there is no migration that fixes that.
    for (const legacy of ["idea", "issue", "confusing", "praise"]) {
      expect(FEEDBACK_CATEGORIES as readonly string[]).toContain(legacy)
      expect(normalizeCategory(legacy)).toBe(legacy)
    }
  })

  it("support subjects lead and feedback subjects follow", () => {
    const all = FEEDBACK_CATEGORIES as readonly string[]
    const lastSupport = all.indexOf(SUPPORT_SUBJECTS[SUPPORT_SUBJECTS.length - 1])
    const firstFeedback = all.indexOf(FEEDBACK_SUBJECTS[0])
    expect(lastSupport).toBeLessThan(firstFeedback)
  })

  it("every subject has a label, and no label is a raw key", () => {
    for (const c of FEEDBACK_CATEGORIES) {
      const label = FEEDBACK_CATEGORY_LABELS[c]
      expect(label, c).toBeTruthy()
      expect(label, c).not.toBe(c)
      expect(label, c).not.toMatch(/_/)
    }
    for (const s of SIGNIN_SUBJECTS) {
      expect(SIGNIN_SUBJECT_LABELS[s], s).toBeTruthy()
    }
  })

  it("no label carries an em dash, and none names a data provider", () => {
    const labels = [
      ...Object.values(FEEDBACK_CATEGORY_LABELS),
      ...Object.values(SIGNIN_SUBJECT_LABELS),
    ]
    for (const l of labels) {
      expect(l).not.toMatch(/[—–]/)
      expect(l).not.toMatch(/dataforseo|outscraper|firecrawl|data365|gemini|anthropic/i)
    }
  })

  it("rejects an unknown subject rather than storing it", () => {
    expect(normalizeCategory("nonsense")).toBeNull()
    expect(normalizeCategory("")).toBeNull()
    expect(normalizeCategory(null)).toBeNull()
  })
})

describe("the logged-out door is deliberately narrow", () => {
  it("offers exactly three subjects, all about getting in", () => {
    // Offering "something in my brief looks wrong" to someone who cannot see their brief invites
    // misrouted submissions and gives us worse data than no category at all.
    expect(SIGNIN_SUBJECTS).toHaveLength(3)
    for (const s of SIGNIN_SUBJECTS) expect(isSigninSubject(s)).toBe(true)
  })

  it("does NOT accept a full support subject as a sign-in subject", () => {
    for (const s of SUPPORT_SUBJECTS) expect(isSigninSubject(s)).toBe(false)
    for (const s of FEEDBACK_SUBJECTS) expect(isSigninSubject(s)).toBe(false)
  })

  it("still normalizes a sign-in subject, so one normalizer serves both doors", () => {
    expect(normalizeCategory("signin_link")).toBe("signin_link")
  })
})

describe("validation: reject nothing a human might really type", () => {
  it("accepts ordinary addresses and lowercases them", () => {
    expect(normalizeEmail("  Mike@SugarBacon.com ")).toBe("mike@sugarbacon.com")
    expect(normalizeEmail("a+tag@sub.domain.co.uk")).toBe("a+tag@sub.domain.co.uk")
  })

  it("rejects what is clearly not an address", () => {
    for (const bad of ["", "   ", "nope", "no@domain", "a b@c.com", "@x.com", "x@.com"]) {
      expect(normalizeEmail(bad), bad).toBeNull()
    }
  })

  it("requires a business name but accepts anything a restaurant might be called", () => {
    expect(normalizeBusinessName("  407 BBQ  ")).toBe("407 BBQ")
    expect(normalizeBusinessName("V's Italiano Ristorante")).toBe("V's Italiano Ristorante")
    expect(normalizeBusinessName("   ")).toBeNull()
  })

  it("bounds the long fields so one submission cannot bloat a row", () => {
    expect(normalizeEmail("a".repeat(400) + "@x.com")).toBeNull() // truncated then invalid
    expect(normalizeBusinessName("x".repeat(500))!.length).toBe(200)
    expect(normalizeMessage("y".repeat(9000))!.length).toBe(4000)
  })

  it("an empty message is refused, because a blank request cannot be acted on", () => {
    expect(normalizeMessage("   ")).toBeNull()
  })
})

describe("reference id", () => {
  it("is short, uppercase and derived from the row id", () => {
    const r = referenceFor("3c2dd8dc-e603-8118-a698-ddbf49df80ef")
    expect(r).toBe("TK-3C2DD8")
    expect(r).toMatch(/^TK-[0-9A-F]{6}$/)
  })

  it("is stable for the same row and different across rows", () => {
    const a = "11111111-2222-3333-4444-555555555555"
    const b = "99999999-2222-3333-4444-555555555555"
    expect(referenceFor(a)).toBe(referenceFor(a))
    expect(referenceFor(a)).not.toBe(referenceFor(b))
  })

  it("is readable down a phone: no lowercase, no ambiguous punctuation", () => {
    const r = referenceFor("abcdef01-2345-6789-abcd-ef0123456789")
    expect(r).toBe(r.toUpperCase())
    expect(r).not.toMatch(/[^A-Z0-9-]/)
  })
})
