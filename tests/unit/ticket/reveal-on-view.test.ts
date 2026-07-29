import { describe, it, expect } from "vitest"
import {
  effectiveRevealThreshold,
  shouldRevealStartHidden,
} from "@/components/ticket/reveal-logic"

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

// ── Blank-page regression guard (the /home/pool report) ──────────────────────
//
// An IntersectionObserver threshold is a share of the TARGET'S OWN area, so the most
// that can ever intersect an element taller than the viewport is vh / elementHeight.
// At the 0.2 default, anything over ~5 viewports tall can never satisfy it: the
// callback never reports isIntersecting and the subtree stays at opacity 0 forever.
// Measured in a browser: a 12,000px element in a 720px viewport tops out at ratio
// 0.043, so 0.2 reported isIntersecting:false while 0.01 fired normally.

describe("effectiveRevealThreshold", () => {
  it("leaves a normal-sized block's threshold alone (entrance animations unchanged)", () => {
    expect(effectiveRevealThreshold(0.2, 200, VPH)).toBe(0.2)
    expect(effectiveRevealThreshold(0.2, VPH, VPH)).toBe(0.2)
  })

  it("keeps the requested threshold while it is still reachable", () => {
    // 1600px tall in an 800px viewport: ceiling is 0.5, so 0.2 is fine.
    expect(effectiveRevealThreshold(0.2, 1600, VPH)).toBe(0.2)
  })

  it("drops to first-contact once the requested threshold is unreachable", () => {
    // The real bug: a long uncapped feed. Ceiling here is 800/12000 = 0.067 < 0.2.
    expect(effectiveRevealThreshold(0.2, 12_000, VPH)).toBe(0)
  })

  it("drops at the exact boundary where the threshold equals the ceiling", () => {
    // 4000px in an 800px viewport: ceiling is exactly 0.2, which is not > 0.2.
    expect(effectiveRevealThreshold(0.2, 4000, VPH)).toBe(0)
  })

  it("never returns a threshold the element cannot reach", () => {
    for (const height of [900, 1200, 2500, 4000, 8000, 40_000]) {
      const t = effectiveRevealThreshold(0.2, height, VPH)
      expect(t).toBeLessThan(VPH / height)
    }
  })

  it("leaves the caller's intent alone when the element is not laid out yet", () => {
    expect(effectiveRevealThreshold(0.2, 0, VPH)).toBe(0.2)
    expect(effectiveRevealThreshold(0.2, -1, VPH)).toBe(0.2)
  })

  it("survives a nonsense viewport without hiding content", () => {
    expect(effectiveRevealThreshold(0.2, 12_000, 0)).toBe(0.2)
    expect(effectiveRevealThreshold(0.2, Number.NaN, VPH)).toBe(0.2)
    expect(effectiveRevealThreshold(0.2, 12_000, Number.POSITIVE_INFINITY)).toBe(0.2)
  })
})
