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
