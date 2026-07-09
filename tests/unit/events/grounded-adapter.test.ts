import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { fetchGroundedEvents, GroundedEventsError } from "@/lib/providers/gemini/google-events"

type Captured = Record<string, unknown>

/** Mock global.fetch to return a Gemini-shaped response and capture the request body. */
function mockFetch(res: { ok?: boolean; status?: number; text?: string; parts?: string; finishReason?: string }): {
  body: () => Captured
} {
  let captured: Captured = {}
  global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
    captured = JSON.parse(init.body)
    if (res.ok === false) {
      return { ok: false, status: res.status ?? 500, text: async () => res.text ?? "" } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: res.parts !== undefined ? { parts: [{ text: res.parts }] } : { parts: [] },
            finishReason: res.finishReason ?? "STOP",
          },
        ],
      }),
    } as unknown as Response
  }) as unknown as typeof fetch
  return { body: () => captured }
}

const GOOD = JSON.stringify({
  events: [
    {
      title: "Texas Rangers vs Houston Astros",
      type: "sports",
      venue: { name: "Globe Life Field", address: "734 Stadium Dr", city: "Arlington" },
      startDatetime: "2026-07-10T19:05",
      endDatetime: null,
      ticketed: true,
      ticketUrl: "https://mlb.com/rangers/tickets",
      officialUrl: null,
    },
  ],
})

describe("fetchGroundedEvents", () => {
  const realFetch = global.fetch
  const hadKey = process.env.GOOGLE_AI_API_KEY
  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = "test-key"
  })
  afterEach(() => {
    global.fetch = realFetch
    if (hadKey === undefined) delete process.env.GOOGLE_AI_API_KEY
    else process.env.GOOGLE_AI_API_KEY = hadKey
    vi.restoreAllMocks()
  })

  it("sends a Flash + google_search, temperature-0, thinking-capped request", async () => {
    const f = mockFetch({ parts: GOOD })
    await fetchGroundedEvents({ locationName: "Arlington, TX", lat: 32.7, lng: -97.1 })
    const b = f.body() as { tools?: unknown; generationConfig?: Record<string, unknown> }
    expect(b.tools).toEqual([{ google_search: {} }])
    expect(b.generationConfig?.temperature).toBe(0)
    expect(b.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 2048 })
  })

  it("parses a well-formed events array", async () => {
    mockFetch({ parts: GOOD })
    const events = await fetchGroundedEvents({ locationName: "Arlington, TX" })
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe("Texas Rangers vs Houston Astros")
    expect(events[0].type).toBe("sports")
    expect(events[0].ticketed).toBe(true)
  })

  it("returns [] on a well-formed empty result (never throws)", async () => {
    mockFetch({ parts: JSON.stringify({ events: [] }) })
    await expect(fetchGroundedEvents({ locationName: "Nowhere, TX" })).resolves.toEqual([])
  })

  it("coerces an out-of-enum type to 'other' and skips nameless/dateless events", async () => {
    mockFetch({
      parts: JSON.stringify({
        events: [
          { title: "Hoedown", type: "barn-dance", venue: { name: "The Barn" }, startDatetime: "2026-08-01T18:00", ticketed: false },
          { title: "", type: "sports", startDatetime: "2026-08-01", ticketed: false }, // no title → skip
          { title: "No date", type: "concert", startDatetime: "", ticketed: false }, // no date → skip
        ],
      }),
    })
    const events = await fetchGroundedEvents({ locationName: "X, TX" })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("other")
  })

  it("throws quota on 429 (so the pipeline fails fast to fallback)", async () => {
    mockFetch({ ok: false, status: 429, text: "quota exceeded" })
    await expect(fetchGroundedEvents({ locationName: "X, TX" })).rejects.toMatchObject({ code: "quota" })
  })

  it("throws http_error on a 4xx", async () => {
    mockFetch({ ok: false, status: 400, text: "bad request" })
    await expect(fetchGroundedEvents({ locationName: "X, TX" })).rejects.toMatchObject({ code: "http_error" })
  })

  it("throws empty_content on a 200 with no text (MAX_TOKENS)", async () => {
    mockFetch({ finishReason: "MAX_TOKENS" }) // no `parts` → empty parts array
    await expect(fetchGroundedEvents({ locationName: "X, TX" })).rejects.toMatchObject({ code: "empty_content" })
  })

  it("throws parse_error on unparseable text", async () => {
    mockFetch({ parts: "sorry, I could not find events" })
    await expect(fetchGroundedEvents({ locationName: "X, TX" })).rejects.toMatchObject({ code: "parse_error" })
  })

  it("throws parse_error when the object has no events array", async () => {
    mockFetch({ parts: JSON.stringify({ foo: 1 }) })
    await expect(fetchGroundedEvents({ locationName: "X, TX" })).rejects.toMatchObject({ code: "parse_error" })
  })

  it("throws no_key when GOOGLE_AI_API_KEY is missing", async () => {
    delete process.env.GOOGLE_AI_API_KEY
    await expect(fetchGroundedEvents({ locationName: "X, TX" })).rejects.toBeInstanceOf(GroundedEventsError)
  })
})
