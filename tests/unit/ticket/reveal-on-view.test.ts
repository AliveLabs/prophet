import { describe, it, expect } from "vitest"
import { shouldRevealStartHidden } from "@/components/ticket/reveal-logic"

// ALT-149 regression guard.
//
// RevealOnView server-renders its content fully visible, then on hydration it
// "arms" the entrance animation. The bug: it hid EVERY element (opacity:0 +
// translateY(14px)) on arm — including content already on screen — so
// above-the-fold cards painted in place, got yanked down + transparent, then
// faded back up. That is the "insight cards render then re-wrap" flash.
//
// The fix: only content that is NOT currently in the viewport may start hidden.
// On-screen content stays put (no flash); off-screen content starts hidden (the
// hide is never seen) and fades up when scrolled into view.

const VPH = 800 // viewport height

describe("shouldRevealStartHidden", () => {
  it("does NOT hide an element already in the viewport (above-the-fold, no flash)", () => {
    // hero card sitting at the top of the page on first paint
    const rect = { top: 40, bottom: 360 }
    expect(
      shouldRevealStartHidden({ reduceMotion: false, hasIntersectionObserver: true, rect, viewportHeight: VPH })
    ).toBe(false)
  })

  it("hides an element fully below the fold (its hide is never seen, fades up on scroll)", () => {
    const rect = { top: 1200, bottom: 1500 }
    expect(
      shouldRevealStartHidden({ reduceMotion: false, hasIntersectionObserver: true, rect, viewportHeight: VPH })
    ).toBe(true)
  })

  it("treats an element partially in view (top edge visible) as visible — no flash", () => {
    const rect = { top: 760, bottom: 1100 }
    expect(
      shouldRevealStartHidden({ reduceMotion: false, hasIntersectionObserver: true, rect, viewportHeight: VPH })
    ).toBe(false)
  })

  it("treats an element scrolled just above the top edge as in-view if its bottom is still visible", () => {
    const rect = { top: -50, bottom: 120 }
    expect(
      shouldRevealStartHidden({ reduceMotion: false, hasIntersectionObserver: true, rect, viewportHeight: VPH })
    ).toBe(false)
  })

  it("never hides under prefers-reduced-motion (content stays visible)", () => {
    const rect = { top: 1200, bottom: 1500 } // below fold, but motion is off
    expect(
      shouldRevealStartHidden({ reduceMotion: true, hasIntersectionObserver: true, rect, viewportHeight: VPH })
    ).toBe(false)
  })

  it("never hides when IntersectionObserver is unavailable", () => {
    const rect = { top: 1200, bottom: 1500 }
    expect(
      shouldRevealStartHidden({ reduceMotion: false, hasIntersectionObserver: false, rect, viewportHeight: VPH })
    ).toBe(false)
  })

  it("never hides when the element rect is unavailable", () => {
    expect(
      shouldRevealStartHidden({ reduceMotion: false, hasIntersectionObserver: true, rect: null, viewportHeight: VPH })
    ).toBe(false)
  })
})
