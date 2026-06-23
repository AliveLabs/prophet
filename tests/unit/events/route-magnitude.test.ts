import { describe, it, expect } from "vitest"
import { classifyEventMagnitude, classifyEventRole, isRouteEventTitle } from "@/lib/events/relevance"

describe("isRouteEventTitle", () => {
  it("flags street-closing route events", () => {
    expect(isRouteEventTitle("Cowtown Marathon")).toBe(true)
    expect(isRouteEventTitle("St. Patrick's Day Parade")).toBe(true)
    expect(isRouteEventTitle("Grand Prix of Dallas")).toBe(true)
    expect(isRouteEventTitle("Turkey Trot 5K")).toBe(true)
  })
  it("does not flag fixed-venue events", () => {
    expect(isRouteEventTitle("Taylor Swift | The Eras Tour")).toBe(false)
    expect(isRouteEventTitle("Mavericks vs Lakers")).toBe(false)
  })
})

describe("classifyEventMagnitude — World Cup now classifies major", () => {
  it("FIFA World Cup at a stadium = major (even with no ticket links)", () => {
    expect(
      classifyEventMagnitude({
        title: "FIFA World Cup: Argentina vs Austria",
        venue: { name: "AT&T Stadium" },
        ticketsAndInfo: [],
      })
    ).toBe("major")
  })
  it("rebranded 'Dallas Stadium' still major via the stadium venue + cup keyword", () => {
    expect(
      classifyEventMagnitude({
        title: "World Cup Match Day",
        venue: { name: "Dallas Stadium" },
        ticketsAndInfo: [{ domain: "fifa.com" }, { domain: "ticketmaster.com" }],
      })
    ).toBe("major")
  })
})

describe("classifyEventRole — route corridor + non-route unchanged", () => {
  it("route within 3mi → route_corridor; beyond → out_of_area", () => {
    expect(classifyEventRole(2, "moderate", { isRoute: true })).toBe("route_corridor")
    expect(classifyEventRole(5, "moderate", { isRoute: true })).toBe("out_of_area")
  })
  it("non-route distances classify as before", () => {
    expect(classifyEventRole(0.1, "major")).toBe("local_foot")
    expect(classifyEventRole(2, "minor")).toBe("local_traffic")
    expect(classifyEventRole(10, "major")).toBe("metro_hook")
    expect(classifyEventRole(10, "minor")).toBe("out_of_area")
    expect(classifyEventRole(null, "major")).toBe("ungeocoded")
  })
})
