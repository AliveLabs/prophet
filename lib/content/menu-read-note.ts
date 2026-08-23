// ---------------------------------------------------------------------------
// "How we read it" — the one place that phrases a menu read for a customer (ALT-610).
//
// `parseMeta.notes` renders to the operator under "How we read it" on /content
// (content-board.tsx). It is the only place they can see whether a stored menu came from the
// deterministic parser, from an extraction model, or from published sources, and that distinction
// is the whole of the reliability story. So the note has to name the METHOD.
//
// It must not name the SUPPLIER. That rule is lib/ops/provenance-copy.ts: naming a vendor
// customer-side hands competitors our supply chain.
//
// This module exists because the rule was broken twice in the same field, in two files:
//
//   · PR #227 fixed the scraping side, which said "Extracted via <the scraping vendor> JSON mode".
//   · lib/ai/gemini.ts said `"Google Search grounding: N items across M categories"` and was still
//     live in prod. Two problems in one string: it cites a vendor as OUR data source, and
//     "grounding" is internal jargon that means nothing to a restaurant owner.
//
// Both were the same mistake made independently, because each writer phrased its own note. One
// builder for all three paths is what stops a third.
//
// WHY THE STATIC SCAN DID NOT CATCH EITHER. tests/unit/ops/provenance-copy.test.ts scans
// `app/(dashboard)` and `components`. These strings are BUILT in lib/ and only RENDERED in the
// dashboard, so scanning the render site can never see them. And the grounded one would have
// slipped through even in scope: "Google" is deliberately absent from FORBIDDEN_PROVIDER_TERMS,
// because a customer's own Google Business Profile has to be nameable. What is banned is citing
// Google as our source, and no term list can tell those two apart. A single builder with a test
// over its whole output can.
// ---------------------------------------------------------------------------

/** How a stored menu read was obtained. Deliberately about method, never about supplier. */
export type MenuReadMethod =
  /** The deterministic parser read the restaurant's own menu page. */
  | "page"
  /** A model extracted the menu from the page's text, because the parser could not. */
  | "extraction_model"
  /** Assembled from menus published elsewhere, when we could not read the page at all. */
  | "published_sources"

/** The operator-facing note for one menu read. Pure, so the guard can enumerate every output. */
export function menuReadNote(
  method: MenuReadMethod,
  itemCount: number,
  categoryCount: number,
): string {
  const scale = `(${itemCount} items across ${categoryCount} categories)`
  switch (method) {
    case "page":
      return `Read the menu page directly ${scale}`
    case "extraction_model":
      return `Read the menu page with an extraction model ${scale}`
    case "published_sources":
      return `Found the menu published elsewhere ${scale}`
  }
}

/** Every method, so a test can assert the rule over the whole output space rather than samples. */
export const MENU_READ_METHODS: readonly MenuReadMethod[] = [
  "page",
  "extraction_model",
  "published_sources",
]
