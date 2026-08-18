// Re-check the country of locations we already hold (ALT-606).
//
// Split from the cron route so the classification is unit-testable: the route does auth, the
// read and the alert; every decision about what counts as a finding lives here.

import { fetchPlaceDetails, mapPlaceToLocation, PlacesLookupError } from "@/lib/places/google"
import { isServedCountry, normalizeCountry } from "./us-only"

export type AuditableLocation = {
  id: string
  name?: string | null
  country?: string | null
  primary_place_id?: string | null
  organization_id?: string | null
}

export type CountryFinding = {
  locationId: string
  organizationId: string | null
  name: string | null
  /** What the row claims. Untrustworthy on the degraded path, which is the point of this audit. */
  storedCountry: string | null
  /** What Places says today, or null when it could not be resolved. */
  resolvedCountry: string | null
  verdict: "served" | "unsupported" | "unverifiable"
}

/** One location, re-resolved. Never throws: a failure IS a finding. */
export async function auditLocation(row: AuditableLocation): Promise<CountryFinding> {
  const base = {
    locationId: row.id,
    organizationId: row.organization_id ?? null,
    name: row.name ?? null,
    storedCountry: row.country ?? null,
  }
  if (!row.primary_place_id) {
    return { ...base, resolvedCountry: null, verdict: "unverifiable" }
  }
  try {
    const mapped = mapPlaceToLocation(await fetchPlaceDetails(row.primary_place_id))
    const resolved = normalizeCountry(mapped.country_code ?? mapped.country)
    return {
      ...base,
      resolvedCountry: resolved,
      verdict: resolved && isServedCountry(resolved) ? "served" : "unsupported",
    }
  } catch (err) {
    // A vendor blip and a dead listing both land here. Neither is proof of anything, so both
    // report as `unverifiable` and neither raises the alarm on its own. A row that stays
    // unverifiable across runs is the one worth a look.
    if (!(err instanceof PlacesLookupError)) {
      console.warn("[country-audit] unexpected lookup failure:", err)
    }
    return { ...base, resolvedCountry: null, verdict: "unverifiable" }
  }
}

/**
 * Audit a set of locations, one at a time.
 *
 * Serial on purpose. This runs on a schedule against a table that is currently single digits and
 * will be low thousands at scale; a burst of parallel Places calls buys minutes we do not need
 * and risks the rate limit that would turn every row into a false `unverifiable`.
 */
export async function auditLocationCountries(
  rows: readonly AuditableLocation[],
): Promise<CountryFinding[]> {
  const out: CountryFinding[] = []
  for (const row of rows) out.push(await auditLocation(row))
  return out
}

/** Findings worth a human's attention, split by what the human would do about them. */
export function summarizeCountryAudit(findings: readonly CountryFinding[]): {
  unsupported: CountryFinding[]
  unverifiable: CountryFinding[]
  served: number
} {
  return {
    unsupported: findings.filter((f) => f.verdict === "unsupported"),
    unverifiable: findings.filter((f) => f.verdict === "unverifiable"),
    served: findings.filter((f) => f.verdict === "served").length,
  }
}

/**
 * Rows whose stored country DISAGREES with what Places says today.
 *
 * Not used to alert (a US row that resolves US is fine however it is spelled), but it is the
 * query worth running by hand when investigating: a disagreement is the fingerprint of a value
 * that came from the client rather than from Google.
 */
export function countryMismatches(findings: readonly CountryFinding[]): CountryFinding[] {
  return findings.filter((f) => {
    if (!f.resolvedCountry) return false
    const stored = normalizeCountry(f.storedCountry)
    return stored !== null && stored !== f.resolvedCountry
  })
}
