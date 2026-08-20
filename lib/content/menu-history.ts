// ALT-363 — load a menu the way every consumer should: as the UNION of the recent captures,
// not as the single latest raw scrape.
//
// ── Why this file exists ────────────────────────────────────────────────────────────────────
// The raw menu scrape is genuinely unstable, and that is site and vendor reality rather than
// something to fix in the scraper. Measured in prod 2026-08-20, same menus, repeat captures:
//
//     20 captures:  3 to 110 items   (36.7x)
//     20 captures:  3 to  89 items   (29.7x)
//     31 captures:  4 to  72 items   (18.0x)
//     22 captures: 16 to 169 items   (10.6x)
//
// `unionRecentMenus` is the defence, and three call sites used it: the insights pipeline, the
// content pipeline and the /content refresh action. `lib/insights/dossier/build.ts` did NOT. It
// had its own copy of the snapshot query and read the single latest raw capture, for both the
// operator's own menu and every competitor's. So on any day a scrape returned 3 items, every
// producer skill received a 3-item menu as ground truth for a menu we already knew ran to 110.
//
// That is the worst place for it to happen: the dossier is what the skills reason over, and a
// thin read there becomes a confident claim about a competitor's menu.
//
// Each of those four call sites had its own copy of the same query, which is HOW the dossier
// drifted. This is the one loader. New consumers use it rather than writing a fifth copy.
//
// ── What it does not do ─────────────────────────────────────────────────────────────────────
// Freshness still comes from the newest RAW capture's date. Unioning is not a claim that we
// looked again, so `dateKey` reports when we last actually scraped.
//
// It does not smooth reads for the sustained-change detector, which deliberately runs on the raw
// per-run captures: its thin-read and one-run-blip guards are meaningless against a smoothed
// union. Callers that need the raw history still load it themselves.

import { unionRecentMenus, MENU_HISTORY_WINDOW } from "@/lib/content/menu-parse"
import type { MenuSnapshot } from "@/lib/content/types"

// The Supabase query builder is deeply generic and thenable rather than a Promise, so a
// hand-rolled structural type for it does not typecheck (and generating one blows the
// instantiation depth limit). This narrows it at the boundary instead: callers pass their real
// client, and the two functions below cast once, right where the query is written, so the cast is
// visible next to the thing it describes rather than hidden behind a fake interface.
type QueryResult = { data: { raw_data: unknown; date_key?: string }[] | null }

type MenuHistoryClient = {
  from: (table: string) => unknown
}

/** One narrow cast, at the query. */
function menuQuery(
  sb: MenuHistoryClient,
  table: string,
  idColumn: string,
  idValue: string,
  typeColumn: string,
  typeValue: string,
  windowSize: number
): Promise<QueryResult> {
  const builder = sb.from(table) as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<QueryResult>
          }
        }
      }
    }
  }
  return builder
    .select("raw_data, date_key")
    .eq(idColumn, idValue)
    .eq(typeColumn, typeValue)
    .order("date_key", { ascending: false })
    .limit(windowSize)
}

export type MenuRead = {
  /** The UNION of the recent window. This is what to reason over. */
  menu: MenuSnapshot | null
  /** When we last actually scraped, from the newest RAW capture. Unioning is not a re-read. */
  dateKey: string | null
  /** The raw captures, newest-first, for callers that legitimately need them (the
   *  sustained-change detector). Empty when there is no history. */
  history: MenuSnapshot[]
}

const EMPTY: MenuRead = { menu: null, dateKey: null, history: [] }

/** The operator's own menu: `location_snapshots`, provider `firecrawl_menu`. */
export async function loadLocationMenu(
  sb: MenuHistoryClient,
  locationId: string,
  windowSize: number = MENU_HISTORY_WINDOW
): Promise<MenuRead> {
  try {
    const { data } = await menuQuery(
      sb, "location_snapshots", "location_id", locationId, "provider", "firecrawl_menu", windowSize
    )
    return fromRows(data)
  } catch {
    // Fail soft, exactly as the query this replaces did. A dossier that throws on a menu read
    // takes the whole brief down; a dossier with no menu just says less.
    return EMPTY
  }
}

/** A competitor's menu: `snapshots`, snapshot_type `web_menu_weekly`.
 *
 *  Competitor menus are where the instability was MEASURED (every spread above is a competitor),
 *  so this matters at least as much as the own-menu path. */
export async function loadCompetitorMenu(
  sb: MenuHistoryClient,
  competitorId: string,
  windowSize: number = MENU_HISTORY_WINDOW
): Promise<MenuRead> {
  try {
    const { data } = await menuQuery(
      sb, "snapshots", "competitor_id", competitorId, "snapshot_type", "web_menu_weekly", windowSize
    )
    return fromRows(data)
  } catch {
    return EMPTY
  }
}

/** Pure: rows (newest-first) to a union plus its raw history. Exported for tests, which is the
 *  point of keeping the shaping separate from the query. */
export function fromRows(rows: { raw_data: unknown; date_key?: string }[] | null | undefined): MenuRead {
  const history = (rows ?? [])
    .map((r) => r.raw_data as MenuSnapshot | null)
    .filter((s): s is MenuSnapshot => !!s && !!s.categories)
  if (history.length === 0) return EMPTY
  return {
    menu: unionRecentMenus(history),
    // Newest RAW capture, not the union. Freshness is about when we looked.
    dateKey: rows?.[0]?.date_key ?? null,
    history,
  }
}
