// ---------------------------------------------------------------------------
// ALT-636 — asking DataForSEO about the RESTAURANT'S market instead of about America.
//
// THE BUG. Ten DataForSEO endpoints did `location_code: input.locationCode ?? 2840`, and 2840 is the
// entire United States. No caller anywhere in the app ever passed a `locationCode`: every call site
// sent only `target` and `limit`. So a card titled "whether you show up in local search" was
// populated with US-NATIONAL rankings by construction. Chris's "these pills are not related to my
// area" was correct about the data, not just about the sort order.
//
// ALT-623 shipped a display-side filter, which stops us CLAIMING locality we do not have. It cannot
// manufacture local rankings that were never requested. This is that request.
//
// `google-events.ts` already did this correctly and is the shape copied here: send `location_name`,
// and when DataForSEO does not recognise the name (status 40501, "Invalid Field: 'location_name'")
// fall back rather than losing the call. That fallback is not hypothetical: real names like
// "McKinney,Texas,United States" are rejected while Forney and Arlington are accepted.
//
// WHY THE FALLBACK IS NATIONAL AND NOT AN ERROR. National data is worse than local data and far
// better than no data: the rest of the Visibility surface still works, and the alternative is a
// blank card. But it must be VISIBLE, which is what `scope` is for. Falling back silently is how
// this bug survived in the first place.
// ---------------------------------------------------------------------------

import { DataForSEOError } from "./client"

/** DataForSEO's location_code for the whole United States. */
export const LOCATION_CODE_US = 2840

/**
 * The location argument shared by every DataForSEO endpoint that takes one.
 *
 * DataForSEO requires EXACTLY ONE of location_name / location_coordinate / location_code, so this
 * is deliberately not two independent optional fields on a task body.
 */
export type LocationArg = { locationName?: string; locationCode?: number }

/** Which market the numbers actually describe. Stamped onto the snapshot; see the pipeline. */
export type LocationScope = "local" | "national"

/**
 * `"City,Region,United States"`, the format DataForSEO's location_name expects.
 *
 * Extracted here because this was already duplicated as a private function in
 * `lib/jobs/pipelines/events.ts` and `app/(dashboard)/events/actions.ts`. Writing a third copy for
 * the SEO family is how the two existing copies would have drifted apart.
 *
 * Returns null when there is no city, because "Texas,United States" is a state-wide query dressed
 * up as a local one, and a caller that cannot be local should say so rather than quietly widen.
 */
export function buildLocationName(
  location:
    | { city?: string | null; region?: string | null; country?: string | null }
    | null
    | undefined,
): string | null {
  // ⚠️ Tolerates a missing location object on purpose, and this is NOT defensive noise. Every SEO
  // call site sits inside a try/catch that soft-degrades a non-payment error. If building the name
  // could throw, that throw would be caught there and reported as "this call failed", which would
  // SWALLOW a genuine DataForSEO payment outage that the worker needs to see. A test caught exactly
  // that: a 402 came back as a clean skip. Never let deciding WHERE to ask be able to hide WHAT the
  // vendor said.
  const city = location?.city?.trim()
  if (!city) return null
  return [city, location?.region?.trim(), location?.country?.trim() || "United States"]
    .filter(Boolean)
    .join(",")
}

/** The location field pair for a task body: exactly one of name or code, never both. */
export function locationTask(input: LocationArg): Record<string, unknown> {
  return input.locationName
    ? { location_name: input.locationName }
    : { location_code: input.locationCode ?? LOCATION_CODE_US }
}

/** Is this the specific "we do not know that place" refusal, as opposed to a real failure? */
export function isUnknownLocationError(err: unknown): boolean {
  return (
    err instanceof DataForSEOError &&
    err.taskStatusCode === 40501 &&
    /location_name/i.test(err.message)
  )
}

/**
 * Run a DataForSEO call against the location's own market, falling back to national ONLY when
 * DataForSEO does not recognise the place.
 *
 * Any other error propagates untouched. That matters: a 402 (out of credits) or a 429 must keep
 * reaching the vendor-health detector as itself, not be laundered into a quiet national retry that
 * looks like a success. This narrows on exactly one status code for that reason.
 *
 * `locationName` of null means the caller has no city to ask about, so it goes straight to national
 * without burning a call that is certain to be refused.
 */
export async function withLocationScope<T>(
  locationName: string | null,
  call: (arg: LocationArg) => Promise<T>,
): Promise<{ result: T; scope: LocationScope }> {
  if (!locationName) {
    return { result: await call({ locationCode: LOCATION_CODE_US }), scope: "national" }
  }
  try {
    return { result: await call({ locationName }), scope: "local" }
  } catch (err) {
    if (!isUnknownLocationError(err)) throw err
    console.warn(
      `[dataforseo] location_name "${locationName}" not recognised (40501) — falling back to ` +
        `US-national scope for this call. The numbers are national, and the snapshot records that.`,
    )
    return { result: await call({ locationCode: LOCATION_CODE_US }), scope: "national" }
  }
}
