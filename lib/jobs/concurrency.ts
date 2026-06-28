// Bounded-concurrency helper for the data pipelines (ENG-M6). Extracted from content.ts so the
// SEO/insights pipelines reuse ONE tested primitive instead of re-rolling serial per-item loops.

/**
 * Run an async `fn` over `items` with bounded concurrency (sequential batches of `limit`). Uses
 * Promise.allSettled so ONE item's rejection never aborts the batch — callers handle per-item errors
 * inside `fn` (the pipelines are fail-soft per item). `limit` is floored at 1 (a 0/negative limit
 * would otherwise spin forever). NOTE: the ORDER of side effects across items is not guaranteed, so
 * keep results keyed (Map by id) rather than positional.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.floor(limit))
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(fn))
  }
}
