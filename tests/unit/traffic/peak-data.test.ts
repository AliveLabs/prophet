import { describe, expect, it } from "vitest"
import { buildPeakData } from "@/lib/traffic/peak-data"

// ── ALT-722 ─────────────────────────────────────────────────────────────────────────────────
// `avg_peak` is a mean over however many day-rows a competitor happens to have, and the traffic
// page both RANKS on it and captioned it "Avg busy across the week". A competitor with three rows
// was averaged over three and compared against one averaged over seven, so a closed or simply
// missing day RAISED its average and its rank.
//
// The mean deliberately still divides by observed days: an absent day is missing data, not a day
// of no customers, and inventing a zero would be its own fabrication. The count now travels with
// it so a caller can see when two numbers are not comparable.

const day = (dow: number, peak: number) => ({
  day_of_week: dow,
  hourly_scores: Array.from({ length: 24 }, () => peak),
  peak_hour: 12,
  peak_score: peak,
  typical_time_spent: null as string | null,
})

const comp = (name: string, peaks: number[]) => ({
  competitor_name: name,
  days: peaks.map((p, i) => day(i, p)),
  current_popularity: null,
})

describe("buildPeakData: the average carries its denominator (ALT-722)", () => {
  it("reports how many days it averaged over", () => {
    const rows = buildPeakData([comp("Full", [90, 80, 70, 60, 50, 40, 30]), comp("Partial", [90, 80, 70])])
    const full = rows.find((c) => c.competitor_name === "Full")!
    const partial = rows.find((c) => c.competitor_name === "Partial")!
    expect(full.days_observed).toBe(7)
    expect(partial.days_observed).toBe(3)
  })

  it("shows the inflation the missing days cause, rather than hiding it", () => {
    const rows = buildPeakData([
      comp("Quiet days too", [90, 80, 70, 10, 10, 10, 10]),
      comp("Good days only", [90, 80, 70]),
    ])
    const quiet = rows.find((c) => c.competitor_name === "Quiet days too")!
    const good = rows.find((c) => c.competitor_name === "Good days only")!
    expect(good.avg_peak).toBeGreaterThan(quiet.avg_peak)
    expect(good.days_observed).not.toBe(quiet.days_observed)
  })

  it("averages over observed days, never inventing a zero for a missing one", () => {
    const [c] = buildPeakData([comp("Three", [60, 60, 60])])
    expect(c.avg_peak).toBe(60)
    expect(c.days_observed).toBe(3)
  })

  it("handles a competitor with no day rows at all", () => {
    const [c] = buildPeakData([comp("Empty", [])])
    expect(c.avg_peak).toBe(0)
    expect(c.days_observed).toBe(0)
    expect(c.busiest_day).toBe("N/A")
  })
})
