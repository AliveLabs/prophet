// Pure decision logic for <RevealOnView> entrance animation — extracted so it can
// be unit-tested without a DOM (see tests/unit/ticket/reveal-on-view.test.ts).
//
// ALT-149: content is server-rendered fully visible. On hydration the component
// "arms" the fade-up reveal. We must NOT hide content that is already in the
// viewport on first paint — hiding it (opacity:0 + translateY) after SSR painted
// it in place causes an above-the-fold flash ("cards render then re-wrap"). Only
// off-screen content may start hidden: the hide is never seen, and it fades up
// when scrolled into view.

export type RevealStartInput = {
  reduceMotion: boolean
  hasIntersectionObserver: boolean
  rect: { top: number; bottom: number } | null
  viewportHeight: number
}

export function shouldRevealStartHidden({
  reduceMotion,
  hasIntersectionObserver,
  rect,
  viewportHeight,
}: RevealStartInput): boolean {
  // No animation at all (reduced-motion / no IO / no element) → never hide.
  if (reduceMotion || !hasIntersectionObserver || !rect) return false
  // Already intersecting the viewport → keep visible so it never flashes.
  const inViewport = rect.top < viewportHeight && rect.bottom > 0
  return !inViewport
}

// An IntersectionObserver threshold is a share of THE TARGET'S OWN area, not of the
// viewport. So the most that can ever intersect a target taller than the viewport is
// viewportHeight / elementHeight — and at the 0.2 default, anything over ~5 viewports
// tall can NEVER satisfy it. The callback never reports isIntersecting and the subtree
// stays at opacity 0 forever.
//
// That was the /home/pool blank-page bug: the page wraps its whole uncapped feed in one
// <RevealOnView>, which on a real pool is tens of thousands of pixels tall. Measured in
// a browser: a 12,000px element against a 720px viewport tops out at ratio 0.043, so a
// 0.2 threshold reported isIntersecting:false, while 0.01 fired normally.
//
// For an element taller than the viewport, "20% of it is showing" is not a meaningful
// trigger anyway; first contact is. Normal-sized blocks keep the requested threshold, so
// every existing entrance animation is untouched.
export function effectiveRevealThreshold(
  requested: number,
  elementHeight: number,
  viewportHeight: number,
): number {
  if (!Number.isFinite(elementHeight) || !Number.isFinite(viewportHeight)) return requested
  // Not laid out yet (height 0) or a nonsense viewport → leave the caller's intent alone.
  if (elementHeight <= 0 || viewportHeight <= 0) return requested
  if (elementHeight <= viewportHeight) return requested
  // Reachable ceiling for this element. If the request is already under it, honor it.
  const maxReachable = viewportHeight / elementHeight
  return requested < maxReachable ? requested : 0
}
