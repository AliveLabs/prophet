import { describe, it, expect } from "vitest"
import { pickEventDeepLink } from "@/app/(dashboard)/events/events-map"
import type { NormalizedEvent, EventTicketInfo } from "@/lib/events/types"

// Minimal NormalizedEvent builder — only the fields pickEventDeepLink reads.
function ev(
  partial: Partial<
    Pick<NormalizedEvent, "url" | "ticketsAndInfo" | "venueWebsite">
  >,
): NormalizedEvent {
  return {
    uid: "u1",
    source: "dataforseo_google_events",
    keyword: "events",
    dateRange: "week",
    ...partial,
  }
}

const ticket = (t: Partial<EventTicketInfo>): EventTicketInfo => ({ ...t })

describe("pickEventDeepLink — venueWebsite preference (ALT-210 data layer)", () => {
  it("prefers a real ticket/event link over the venue website", () => {
    const e = ev({
      url: "https://visitdallas.com/",
      venueWebsite: "https://attstadium.com",
      ticketsAndInfo: [ticket({ url: "https://ticketmaster.com/event/123", description: "TICKETS" })],
    })
    expect(pickEventDeepLink(e)).toBe("https://ticketmaster.com/event/123")
  })

  it("prefers the event's own deep-path URL over the venue website", () => {
    const e = ev({
      url: "https://visitdallas.com/events/some-show",
      venueWebsite: "https://attstadium.com",
    })
    expect(pickEventDeepLink(e)).toBe("https://visitdallas.com/events/some-show")
  })

  it("prefers any ticket/info link over the venue website", () => {
    const e = ev({
      url: "https://visitdallas.com/",
      venueWebsite: "https://attstadium.com",
      ticketsAndInfo: [ticket({ url: "https://example.com/more-info" })],
    })
    expect(pickEventDeepLink(e)).toBe("https://example.com/more-info")
  })

  it("returns the venue website when the only event URL is a bare bureau homepage", () => {
    // The exact gap this fixes: scraped event has only a generic bureau landing page and no
    // usable ticket links. The geocoded venue's official site is a real, more-specific target.
    const e = ev({
      url: "https://visitdallas.com/",
      venueWebsite: "https://attstadium.com/events",
    })
    expect(pickEventDeepLink(e)).toBe("https://attstadium.com/events")
  })

  it("returns the venue website when there is no event URL at all", () => {
    const e = ev({ venueWebsite: "https://attstadium.com" })
    expect(pickEventDeepLink(e)).toBe("https://attstadium.com")
  })

  it("falls back to the bare event URL when there is no venue website (unchanged behavior)", () => {
    const e = ev({ url: "https://visitdallas.com/" })
    expect(pickEventDeepLink(e)).toBe("https://visitdallas.com/")
  })

  it("returns null when there is nothing to link to", () => {
    expect(pickEventDeepLink(ev({}))).toBeNull()
  })
})
