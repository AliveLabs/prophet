// ALT-654 / ALT-660. The pipeline list, its labels and the elapsed clock lived in TWO places
// (app/onboarding/onboarding-wizard-pass.tsx and app/(dashboard)/home/first-run-panel.tsx) and had
// drifted. These pin the shared module's contract so a future edit cannot silently re-fork it.
//
// The component itself is .tsx, which vitest does not collect here, so this covers the exported
// pure pieces: the order, the labels, and the elapsed formatter.

import { describe, it, expect } from "vitest"
import {
  PIPELINE_ORDER,
  PIPELINE_LABELS,
  formatElapsed,
  __rowStateForTest,
} from "@/components/first-run/first-run-progress"

describe("ALT-654: the first-run pipeline list has ONE source", () => {
  it("covers every pipeline a first run enqueues, in display order", () => {
    // FIRST_RUN_STARTER + FIRST_RUN_DATA + insights + brief, per lib/jobs/queue.ts.
    expect([...PIPELINE_ORDER]).toEqual([
      "starter",
      "content",
      "visibility",
      "events",
      "weather",
      "busy_times",
      "social",
      "photos",
      "insights",
      "brief",
    ])
  })

  it("labels every pipeline it orders, with no internal ids leaking", () => {
    for (const p of PIPELINE_ORDER) {
      const label = PIPELINE_LABELS[p]
      expect(label, `missing label for ${p}`).toBeTruthy()
      // No snake_case leaking through: "busy_times" must never render as itself.
      expect(label, `${p} label looks like a raw key`).not.toMatch(/_/)
      // A single-word key CAN legitimately equal its label ("weather" -> "Weather"), so the rule is
      // about the multi-word keys, which are the ones that read as internal when unmapped.
      if (p.includes("_")) expect(label.toLowerCase()).not.toBe(p)
    }
  })

  it("renames Search visibility to Local search, per Bryan 2026-08-18", () => {
    expect(PIPELINE_LABELS.visibility).toBe("Local search")
  })
})

describe("ALT-660: the elapsed clock", () => {
  it("formats m:ss under an hour", () => {
    expect(formatElapsed(0)).toBe("0:00")
    expect(formatElapsed(9_000)).toBe("0:09")
    expect(formatElapsed(69_000)).toBe("1:09")
    // the walkthrough's real cold start
    expect(formatElapsed(21.2 * 60_000)).toBe("21:12")
  })

  it("switches to h:mm:ss past an hour, because wedged runs get there", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00")
    expect(formatElapsed(3_723_000)).toBe("1:02:03")
  })

  it("never renders a negative clock", () => {
    // a server runStartedAt slightly ahead of the client clock must not print "-0:01"
    expect(formatElapsed(-5_000)).toBe("0:00")
  })
})

// ALT-656: these rows report a JOB STATUS, not a data outcome. Bryan's concern was that "Ready"
// on search visibility, weather, foot traffic and photos would turn out to mean nothing.
//
// Checked against prod for both 2026-08 walkthroughs: it mostly meant something. Search visibility
// had 7 and 16 SEO snapshots, weather 2 and 3 rows, foot traffic 28 and 21 rows, photos 10 own plus
// 24 competitor each. But Jersey Mike's social pipeline finished with ZERO own-social profiles, so a
// done job genuinely can mean "we looked and found nothing" — which is why the word had to change.
describe("ALT-656: the row word claims only what the job status knows", () => {
  it("a finished job says Done, never Ready", () => {
    const s = __rowStateForTest("done", true)
    expect(s.word).toBe("Done")
    // "Ready" promises the operator a deliverable is waiting. Only the signals block can say that.
    expect(s.word).not.toBe("Ready")
  })

  it("running and failed stay plainly worded", () => {
    expect(__rowStateForTest("running", true).word).toBe("In progress")
    expect(__rowStateForTest("failed", true).word).toBe("Hit a snag")
  })

  it("ALT-655: before the first poll returns it says Starting, not Queued", () => {
    // A full list of "Queued" with nothing shown working reads as a stalled queue, which is what
    // Bryan saw. We genuinely do not know yet at that point, so do not imply we are idle.
    expect(__rowStateForTest(undefined, false).word).toBe("Starting")
    expect(__rowStateForTest(undefined, true).word).toBe("Queued")
  })

  it("an unrecognised status degrades to queued rather than claiming completion", () => {
    expect(__rowStateForTest("something_new", true).word).toBe("Queued")
  })
})
