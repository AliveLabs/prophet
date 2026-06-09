// ---------------------------------------------------------------------------
// freshnessFields — the columns every snapshot write should carry (Phase 1).
//
// One call turns a raw snapshot + capture time into the contract's two columns:
//   content_as_of (real content recency) and freshness (write-time classification).
// Pipelines spread the result into their upsert payload.
// ---------------------------------------------------------------------------

import { extractContentAsOf } from "./extract"
import { classifyAtCapture, type SignalKind, type FreshnessStatus } from "./contract"

export type FreshnessFields = { content_as_of: string | null; freshness: FreshnessStatus }

export function freshnessFields(
  kind: SignalKind,
  raw: Record<string, unknown> | null | undefined,
  capturedAt: string
): FreshnessFields {
  const { contentAsOf, isEmpty } = extractContentAsOf(kind, raw, capturedAt)
  return {
    content_as_of: contentAsOf,
    freshness: classifyAtCapture({ contentAsOf, capturedAt, isEmpty, kind }),
  }
}
