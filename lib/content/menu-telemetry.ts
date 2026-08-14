// ---------------------------------------------------------------------------
// Menu ingestion reliability telemetry (beta rescue 2.6, ALT-363).
//
// Menu data is the product's known weak spot: MENU_INSIGHTS is default-off because menu
// insights were unreliable, and until now a menu run that produced nothing was invisible —
// no snapshot row is written when every source comes back empty, so "how often does the menu
// pipeline fail, and at which stage" was unanswerable. This module records one event per
// menu-ingestion attempt (per location or competitor, per run) with the outcome and a failure
// classification derived from what the pipeline can actually fail on.
//
// OBSERVATION ONLY. This module mirrors lib/eval/record.ts and lib/ai/spend-events.ts:
//   - recordMenuIngestEvent() NEVER throws (any failure is console.warn'd and swallowed),
//   - it never mutates the pipeline's state or influences control flow,
//   - it costs no model call.
// Call sites in a user-facing server action should `void` it (fire and move on); the
// background content job may await it so the write lands before the function suspends.
//
// `menu_ingest_events` is not in the generated DB types, so this uses the same loose-client
// cast as lib/ai/spend-events.ts. The table itself IS live in prod (verified 2026-08-14):
// what it has is zero rows, because the content job runs Sundays and the recorder landed
// after the last one. The types are simply un-regenerated.
//
// DEPLOY ORDER: the "degraded" outcome and the coverage columns need
// supabase/migrations/20260814210000_menu_ingest_degraded_coverage.sql applied FIRST. The
// original CHECK constraint allows only succeeded/empty/failed, so a degraded run inserted
// against an unmigrated database is rejected. The insert never throws (it warns and moves
// on), which means the failure mode is a silently empty ledger: apply the migration with or
// before this code, not after.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { MENU_MIN_COVERAGE_RATIO } from "@/lib/content/menu-parse"

/** Which code path ran the menu ingestion. */
export type MenuRunSource =
  | "content_pipeline" // lib/jobs/pipelines/content.ts (background content job / refresh-all)
  | "content_refresh_action" // app/(dashboard)/content/actions.ts (manual /content refresh)
  | "competitor_enrich" // lib/content/enrich.ts (competitor approve / single-competitor refresh)

export type MenuTargetKind = "location" | "competitor"

/**
 * Per-run verdict. "empty" is distinct from "failed" on purpose: "empty" means the pipeline
 * looked and found no menu (the sources answered, with nothing); "failed" means it could not
 * get a trustworthy answer at all. Conflating the two is exactly what made menu reliability
 * unmeasurable before.
 *
 * "degraded" is the fourth state and the one this whole ticket is about: the run DID produce
 * a menu, it saved fine, and it is badly incomplete against what this same menu has given us
 * before (one prod location's weekly reads ran 12 to 169 items). A degraded run used to be
 * indistinguishable from a healthy one because both merged items and both saved. It is
 * deliberately not folded into "failed": the distinction between "no answer" and "a confident
 * wrong answer" is the entire reliability question here.
 */
export type MenuRunOutcome = "succeeded" | "degraded" | "empty" | "failed"

/** Status of one extraction channel (Firecrawl scraping or Gemini Google-Search grounding). */
export type MenuChannelStatus =
  | "items" // channel produced at least one parsed menu item
  | "empty" // channel ran cleanly but produced zero items
  | "error" // channel errored (threw, returned null, HTTP failure, unparseable JSON)
  | "skipped" // channel never ran

/**
 * Failure taxonomy, derived from the real failure modes in the code:
 * - no_website:         the target has no website to scrape (competitor with no site, or a
 *                       location whose website could not be resolved from Places).
 * - fetch_failed:       every Firecrawl scrape attempt errored or returned nothing, so the
 *                       primary channel never produced a page to parse (Gemini did not rescue
 *                       the run with items either).
 * - enrichment_failed:  the pages that were fetched parsed to zero items AND the Gemini
 *                       backstop call itself errored — the "is this menu really empty?"
 *                       question went unanswered because the enrichment leg was down.
 * - zero_items:         both channels ran cleanly and both found nothing. The strongest
 *                       "there is genuinely no scrapeable menu" signal we can record.
 * - save_failed:        a menu WAS extracted but the snapshot upsert failed, so the data
 *                       never landed. From the product's view this run produced nothing.
 * - pipeline_error:     an unexpected exception in the enrichment path (the outer catch).
 * - low_coverage:       a menu was extracted and saved, but it holds less than
 *                       MENU_MIN_COVERAGE_RATIO of this same menu's best known size. The run
 *                       succeeded mechanically and is wrong substantively: the read that
 *                       looks fine to every other signal and produces confidently incomplete
 *                       claims. Pairs with outcome "degraded", never with "failed".
 */
export type MenuFailureReason =
  | "no_website"
  | "fetch_failed"
  | "parse_empty"
  | "enrichment_failed"
  | "zero_items"
  | "save_failed"
  | "pipeline_error"
  | "low_coverage"

/**
 * Raw, mechanical observations collected as the pipeline runs. Call sites only ever RECORD
 * what happened; all judgement lives in classifyMenuRun so it stays unit-testable.
 */
export type MenuStageObservation = {
  /** Target had a website to scrape at all. */
  hasWebsite: boolean
  /** Menu URLs found by discovery (0 = pipeline fell back to scraping the homepage). */
  urlsDiscovered: number
  /** scrapeMenuPage calls made. */
  scrapeAttempts: number
  /** Attempts that threw or returned null (Firecrawl error / timeout). */
  scrapeErrors: number
  /** Attempts whose normalized parse produced at least one category with items. */
  scrapesWithItems: number
  /** Gemini Google-Search grounding channel status. */
  enrichment: MenuChannelStatus
  /** Item count of the merged menu (0 when nothing merged / nothing found). */
  mergedItems: number
  /**
   * This run's coverage against the same menu's best known size (menuCoverage, stamped onto
   * the snapshot at write time). NULL means no verdict was available, which is the honest
   * state for a new or thinly-sampled target: it must never be read as good coverage.
   */
  coverageRatio: number | null
  /** Best item count credibly read for this menu before, the denominator of coverageRatio. */
  historicalHighItems: number | null
  /** Snapshot upsert error message, if the save was attempted and failed. */
  saveError: string | null
  /** Message from the outer catch, when the whole enrichment path blew up. */
  pipelineError: string | null
}

/** Fresh observation with pessimistic defaults; call sites mutate it as stages complete. */
export function newMenuObservation(): MenuStageObservation {
  return {
    hasWebsite: true,
    urlsDiscovered: 0,
    scrapeAttempts: 0,
    scrapeErrors: 0,
    scrapesWithItems: 0,
    enrichment: "skipped",
    mergedItems: 0,
    coverageRatio: null,
    historicalHighItems: null,
    saveError: null,
    pipelineError: null,
  }
}

/** Derived status of the Firecrawl scraping channel. */
export function firecrawlStatus(obs: MenuStageObservation): MenuChannelStatus {
  if (obs.scrapeAttempts === 0) return "skipped"
  if (obs.scrapesWithItems > 0) return "items"
  if (obs.scrapeErrors >= obs.scrapeAttempts) return "error"
  return "empty" // pages were fetched, none parsed to items
}

export type MenuRunVerdict = {
  outcome: MenuRunOutcome
  reason: MenuFailureReason | null
}

/**
 * Pure classification of one run's observations into (outcome, reason). Deterministic and
 * total: every observation maps to exactly one verdict.
 *
 * Precedence: structural failures first (no website, unexpected exception), then the happy
 * path (items merged -> saved? -> complete enough to be worth anything?), then the zero-item
 * space is split by which channel failed versus which channel genuinely answered "empty".
 */
export function classifyMenuRun(obs: MenuStageObservation): MenuRunVerdict {
  if (!obs.hasWebsite) return { outcome: "failed", reason: "no_website" }
  if (obs.pipelineError) return { outcome: "failed", reason: "pipeline_error" }

  if (obs.mergedItems > 0) {
    if (obs.saveError) return { outcome: "failed", reason: "save_failed" }
    // Nonempty but badly short of this menu's own best known size. Checked only when a
    // verdict EXISTS: an absent ratio (new location, too little history) is "unknown", and
    // guessing "degraded" there would slander every brand-new location's first reads.
    if (typeof obs.coverageRatio === "number" && obs.coverageRatio < MENU_MIN_COVERAGE_RATIO) {
      return { outcome: "degraded", reason: "low_coverage" }
    }
    return { outcome: "succeeded", reason: null }
  }

  // Zero merged items: decide whether we FAILED to look or looked and found nothing.
  const fc = firecrawlStatus(obs)

  // Primary channel down entirely -> we could not fetch, regardless of what Gemini said
  // (a secondary "empty" is not trustworthy when the site itself was never read).
  if (fc === "error") return { outcome: "failed", reason: "fetch_failed" }

  if (fc === "empty") {
    // Pages were fetched but parsed to zero items.
    if (obs.enrichment === "error") return { outcome: "failed", reason: "enrichment_failed" }
    if (obs.enrichment === "empty") return { outcome: "empty", reason: "zero_items" }
    // Gemini never ran: only page-level evidence, which says "no items parseable".
    return { outcome: "empty", reason: "parse_empty" }
  }

  // fc === "skipped" (no scrape attempts were ever made) with zero merged items.
  if (obs.enrichment === "error") return { outcome: "failed", reason: "enrichment_failed" }
  if (obs.enrichment === "empty") return { outcome: "empty", reason: "zero_items" }
  // Nothing ran at all — treat as a fetch failure, never as a clean "empty".
  return { outcome: "failed", reason: "fetch_failed" }
}

export type MenuIngestEventInput = {
  runSource: MenuRunSource
  target: MenuTargetKind
  /** Location this run belongs to. Null only when genuinely unknown. */
  locationId?: string | null
  /** Set for competitor targets; null for the org's own location. */
  competitorId?: string | null
  /** The run's date key (YYYY-MM-DD), same key the snapshot upserts use. */
  dateKey: string
  observation: MenuStageObservation
  /** Sources that contributed items (parseMeta.sources), when a menu was produced. */
  sources?: string[]
}

type MenuEventsClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
  }
}

/**
 * Record one menu-ingestion attempt into menu_ingest_events. NEVER throws: any failure
 * (missing env, RLS, network, the table not existing yet in a given environment) is caught
 * and logged with console.warn, never surfaced to the caller. Safe to call without awaiting;
 * also safe to await (it always resolves, never rejects).
 */
export async function recordMenuIngestEvent(input: MenuIngestEventInput): Promise<void> {
  try {
    const { outcome, reason } = classifyMenuRun(input.observation)
    const admin = createAdminSupabaseClient() as unknown as MenuEventsClient
    const { error } = await admin.from("menu_ingest_events").insert({
      run_source: input.runSource,
      target: input.target,
      location_id: input.locationId ?? null,
      competitor_id: input.competitorId ?? null,
      date_key: input.dateKey,
      outcome,
      failure_reason: reason,
      items_total: input.observation.mergedItems,
      // Promoted out of `stages` into their own columns so a reliability rollup can filter and
      // average on them without unpacking jsonb. Null = no verdict, never "fine".
      coverage_ratio: input.observation.coverageRatio,
      historical_high_items: input.observation.historicalHighItems,
      sources: input.sources ?? [],
      stages: input.observation,
    })
    if (error) {
      console.warn(`[menu-telemetry] insert failed (source=${input.runSource}):`, error.message)
    }
  } catch (err) {
    console.warn(`[menu-telemetry] recorder threw (source=${input.runSource}), ignored:`, err)
  }
}
