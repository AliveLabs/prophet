// ---------------------------------------------------------------------------
// Fixture loader — fail-soft authoritative-schedule access (Events Validation Gate · P13)
//
// Reads the `fixtures` DB table when present (the generalization path: NFL/NBA/MLB/etc.,
// loaded by Bryan's migration), and ALWAYS falls back to the in-code WC2026 seed so the
// gate works on PREVIEW with NO migration. The loader NEVER throws — a query failure, a
// missing table, or empty rows all degrade to the in-code seed. Fixtures are tiny + static,
// so we cache the resolved set in-process (the P9 graceful-loader pattern).
//
// Returns a single index keyed for two questions the validator asks:
//   1. Is `<normalized venue name>` a known scheduled-league venue? → venue identity + window.
//   2. Is there a match at `<venueId, localDate>`? → the authoritative cross-check.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  SEEDED_COMPETITIONS,
  type FixtureCompetition,
  type FixtureMatch,
  type FixtureVenue,
} from "./wc2026"

export type FixtureIndex = {
  /** venueId → venue (incl. aliases + the competition window it belongs to). */
  venuesById: Map<string, FixtureVenue & { competitionId: string; window: { start: string; end: string } }>
  /** normalized venue name OR alias → venueId (rebrand-proof name lookup). */
  venueIdByName: Map<string, string>
  /** `${venueId}|${localDate}` → matches that day at that venue (usually 0-1). */
  matchesByVenueDate: Map<string, FixtureMatch[]>
  /** Did this come from the DB table (true) or the in-code seed fallback (false)? */
  fromTable: boolean
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Build the lookup index from a set of competitions (pure, testable). */
export function buildFixtureIndex(
  competitions: FixtureCompetition[],
  fromTable: boolean,
): FixtureIndex {
  const venuesById = new Map<string, FixtureVenue & { competitionId: string; window: { start: string; end: string } }>()
  const venueIdByName = new Map<string, string>()
  const matchesByVenueDate = new Map<string, FixtureMatch[]>()

  for (const comp of competitions) {
    for (const v of comp.venues) {
      venuesById.set(v.venueId, { ...v, competitionId: comp.competitionId, window: comp.window })
      // The physical name AND every FIFA alias both resolve to this venue identity.
      venueIdByName.set(normalizeName(v.placeName), v.venueId)
      for (const alias of v.aliases) venueIdByName.set(normalizeName(alias), v.venueId)
    }
    for (const m of comp.matches) {
      const key = `${m.venueId}|${m.localDate}`
      const arr = matchesByVenueDate.get(key) ?? []
      arr.push(m)
      matchesByVenueDate.set(key, arr)
    }
  }

  return { venuesById, venueIdByName, matchesByVenueDate, fromTable }
}

/** The in-code seed index — the floor, always available with no migration. */
export function seedFixtureIndex(): FixtureIndex {
  return buildFixtureIndex(SEEDED_COMPETITIONS, false)
}

// ── DB-backed loader (fail-soft) ────────────────────────────────────────────

type FixtureRow = {
  competition_id?: string | null
  venue_id?: string | null
  place_name?: string | null
  city?: string | null
  aliases?: string[] | null
  lat?: number | null
  lng?: number | null
  tz?: string | null
  local_date?: string | null
  local_kickoff?: string | null
  round?: string | null
  label?: string | null
  window_start?: string | null
  window_end?: string | null
}

/** Re-shape flat `fixtures` rows into competitions. A row is a venue row (has place_name +
 *  no local_date) OR a match row (has local_date). Tolerates partial rows. */
function rowsToCompetitions(rows: FixtureRow[]): FixtureCompetition[] {
  const byComp = new Map<string, FixtureCompetition>()
  const ensure = (id: string, start: string, end: string): FixtureCompetition => {
    let c = byComp.get(id)
    if (!c) {
      c = { competitionId: id, displayName: id, window: { start, end }, venues: [], matches: [] }
      byComp.set(id, c)
    }
    return c
  }

  for (const r of rows) {
    const compId = r.competition_id ?? "unknown"
    const comp = ensure(compId, r.window_start ?? "1970-01-01", r.window_end ?? "2999-12-31")
    if (r.window_start) comp.window.start = r.window_start
    if (r.window_end) comp.window.end = r.window_end

    if (r.venue_id && r.place_name && !r.local_date) {
      comp.venues.push({
        venueId: r.venue_id,
        placeName: r.place_name,
        city: r.city ?? "",
        aliases: r.aliases ?? [],
        lat: r.lat ?? 0,
        lng: r.lng ?? 0,
        tz: r.tz ?? "UTC",
      })
    } else if (r.venue_id && r.local_date && r.local_kickoff) {
      comp.matches.push({
        venueId: r.venue_id,
        localDate: r.local_date,
        localKickoff: r.local_kickoff,
        round: (r.round as FixtureMatch["round"]) ?? "group",
        label: r.label ?? "",
      })
    }
  }
  return Array.from(byComp.values())
}

let cached: FixtureIndex | null = null

/** Load the fixture index. Reads the `fixtures` table if present + non-empty (and contains at
 *  least one venue row), else returns the in-code seed. NEVER throws. Cached in-process.
 *  Pass `opts.force` to bypass the cache (tests). */
export async function loadFixtureIndex(
  supabase: SupabaseClient | null | undefined,
  opts: { force?: boolean } = {},
): Promise<FixtureIndex> {
  if (cached && !opts.force) return cached
  if (!supabase) {
    cached = seedFixtureIndex()
    return cached
  }
  try {
    const { data, error } = await supabase
      .from("fixtures")
      .select(
        "competition_id, venue_id, place_name, city, aliases, lat, lng, tz, local_date, local_kickoff, round, label, window_start, window_end",
      )
    if (error || !data || data.length === 0) {
      cached = seedFixtureIndex()
      return cached
    }
    const comps = rowsToCompetitions(data as FixtureRow[])
    const hasVenues = comps.some((c) => c.venues.length > 0)
    // A table with only match rows and no venue identities can't resolve names — fall back.
    cached = hasVenues ? buildFixtureIndex(comps, true) : seedFixtureIndex()
    return cached
  } catch {
    cached = seedFixtureIndex()
    return cached
  }
}

/** Test hook — reset the in-process cache. */
export function __resetFixtureCache(): void {
  cached = null
}
