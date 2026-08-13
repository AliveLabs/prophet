// ALT-583: settings saves must never report success without a row actually written.
//
// Every per-location settings action writes through the USER-scoped Supabase client so
// RLS is the membership check. The trap: PostgREST treats an UPDATE that matches zero
// rows as a success (`error: null`, empty data), and the `locations` UPDATE policy is
// owner/admin-only while SELECT is any-member. So a member-role seat could read the
// settings page, move a slider, and get `{ ok: true }` back while nothing persisted.
// That silent fake success is exactly the "my settings reset overnight" class of report.
//
// The fix is mechanical: every settings UPDATE chains `.select("id")` and classifies
// the outcome here. Zero rows = failure, said out loud.

export type LocationWriteResult = { ok: true } | { ok: false; error: string }

/** Shown when an UPDATE matched no rows. Covers both real causes (a seat without
 *  owner/admin rights under RLS, or a stale/foreign location id) without guessing. */
export const NO_ROW_WRITTEN_ERROR =
  "Nothing was saved. Your seat may not have permission to change this location's settings. Ask the account owner for owner or admin access."

/**
 * Classify the result of a `locations` UPDATE issued through the user-scoped client
 * with `.select("id")` chained. A PostgREST error is a failure with its message; a
 * zero-row match is a failure too (RLS filtered the row out, or the id is wrong),
 * never a success.
 */
export function classifyLocationWrite(
  error: { message: string } | null,
  rows: ReadonlyArray<unknown> | null,
): LocationWriteResult {
  if (error) return { ok: false, error: error.message }
  if (!rows || rows.length === 0) return { ok: false, error: NO_ROW_WRITTEN_ERROR }
  return { ok: true }
}
