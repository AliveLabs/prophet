// Review watchdog DRY RUN: what would each operator see, before they see it.
//
//   npx vercel env pull /tmp/prod.env --environment=production --yes
//   npx tsx scripts/ops/watchdog-dryrun.ts --env /tmp/prod.env
//
// READ-ONLY. It writes nothing, to any table. It calls the SAME functions the nightly insights
// pipeline calls (loadWatchdogCorpus, detectReviewAnomalies, selectFiringAnomalies) and renders
// through the SAME copy builder the /reviews panel and the weekly digest use (buildWatchNotices),
// so the output is what an operator would actually read, not an approximation of it.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
// `review_watch_events` shipped merged-but-unapplied on 2026-08-14 and was applied on 2026-08-21
// (ALT-703, ALT-677 for the class of bug). Detection had been running nightly the whole time, but
// every result was discarded because the table did not exist, so nothing was ever displayed. That
// means the thresholds in REVIEW_WATCHDOG_CONFIG had never been checked against a single real
// restaurant, and the first run after applying would put untested output straight into an
// operator's dashboard AND their weekly digest email.
//
// The red-flag copy in particular is strong ("Several reviews allege discrimination", "Several
// reviews mention people getting sick"). That is the right thing to tell an owner who needs to
// know, and the wrong thing to guess at. So: look first.
//
// Re-run this whenever the config thresholds change, or before turning the panel on for a new
// cohort of locations.

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import { loadWatchdogCorpus } from "../../lib/reviews/watch-events"
import {
  detectReviewAnomalies,
  selectFiringAnomalies,
  cooldownUntilMs,
  anscombeZ,
  REVIEW_WATCHDOG_CONFIG,
} from "../../lib/reviews/watchdog"
import { buildWatchNotices, WATCH_COPY } from "../../lib/reviews/watch-copy"
import type { WatchEventRow } from "../../lib/reviews/watch-events"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Credentials from the environment, or from a `vercel env pull` file. Values are never printed. */
function credentials(): { url: string; key: string } {
  const file = arg("--env")
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  if (file) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      "Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Pull them with: npx vercel env pull /tmp/prod.env --environment=production --yes\n" +
        "then pass --env /tmp/prod.env",
    )
    process.exit(1)
  }
  return { url, key }
}

async function main() {
  const { url, key } = credentials()
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const nowMs = Date.now()

  const cfg = REVIEW_WATCHDOG_CONFIG
  console.log(`\n=== review watchdog dry run @ ${new Date(nowMs).toISOString()} ===`)
  console.log(`project: ${url.replace(/^https:\/\//, "").split(".")[0]}   (READ ONLY, nothing is written)\n`)

  const { data: locations, error: locErr } = await sb
    .from("locations")
    .select("id, name, organization_id, organizations(name, org_kind)")
    .order("name")

  if (locErr || !locations) {
    console.error(`Failed to list locations: ${locErr?.message ?? "no rows"}`)
    process.exit(1)
  }

  // What is already recorded, so the preview reflects real cooldown suppression rather than
  // pretending the table is empty. On the first run this is empty and everything detected fires.
  const { data: existing, error: exErr } = await sb
    .from("review_watch_events")
    .select("location_id, anomaly_key, kind, direction, strength, detail, fired_on, cooldown_until, created_at")
  if (exErr) {
    console.error(`WARNING: could not read review_watch_events (${exErr.message}). Cooldowns not applied.`)
  }
  const recordedByLocation = new Map<string, WatchEventRow[]>()
  for (const r of (existing ?? []) as unknown as WatchEventRow[]) {
    const list = recordedByLocation.get(r.location_id) ?? []
    list.push(r)
    recordedByLocation.set(r.location_id, list)
  }
  console.log(`already recorded: ${(existing ?? []).length} event(s) across ${recordedByLocation.size} location(s)\n`)

  let totalFiring = 0
  let locationsWithSomething = 0
  const byKind = new Map<string, number>()

  for (const loc of locations) {
    const org = (loc as unknown as { organizations?: { name?: string; org_kind?: string } }).organizations
    const label = `${loc.name}  [org: ${org?.name ?? "?"}, kind: ${org?.org_kind ?? "?"}]`
    console.log("─".repeat(100))
    console.log(label)

    const { reviews, lastCapturedAtMs } = await loadWatchdogCorpus(sb as never, loc.id, { nowMs })
    if (reviews.length === 0) {
      console.log("  corpus empty in the lookback window, nothing to detect\n")
      continue
    }
    const withFlags = reviews.filter((r) => r.redFlags.length > 0).length
    console.log(`  corpus: ${reviews.length} reviews, ${withFlags} carrying red flags`)

    // THREE timestamps, not one, because collapsing them is how this gets misread.
    //
    // On 2026-08-21 I read a stale `first_seen_at` as "our collection stopped" and filed a High
    // bug against working code. It is not evidence of a stall: `first_seen_at` cannot advance
    // unless a NEW review exists, so "nothing newly discovered" and "no new reviews" are the SAME
    // observation. `last_seen_at` is the only one of the three that separates them, because the
    // upsert bumps it on every pull whether or not anything new came back
    // (lib/reviews/store.ts). Print all three so the reader can tell:
    //
    //   pulled recently + nothing new discovered  -> a REAL drought, report it
    //   pull itself stale                          -> OUR problem, suppress it
    const { data: stamps } = await sb
      .from("location_reviews")
      .select("first_seen_at, last_seen_at, published_at")
      .eq("location_id", loc.id)
      .order("last_seen_at", { ascending: false })
      .limit(500)
    const maxOf = (key: "first_seen_at" | "last_seen_at" | "published_at"): number | null => {
      let best: number | null = null
      for (const r of (stamps ?? []) as Array<Record<string, unknown>>) {
        const ms = typeof r[key] === "string" ? Date.parse(r[key] as string) : NaN
        if (Number.isFinite(ms) && (best == null || ms > best)) best = ms
      }
      return best
    }
    const ago = (ms: number | null) => (ms == null ? "never" : `${((nowMs - ms) / 86_400_000).toFixed(1)}d ago`)
    const newestFirstSeen = maxOf("first_seen_at")
    const newestPublished = maxOf("published_at")
    const pullFresh = lastCapturedAtMs != null && nowMs - lastCapturedAtMs < 2 * 86_400_000

    console.log(
      `  pull last ran ${ago(lastCapturedAtMs)}${pullFresh ? "" : "   <-- PULL IS STALE, treat any drought as OURS"}`,
    )
    console.log(`  newest review discovered ${ago(newestFirstSeen)}, newest review published ${ago(newestPublished)}`)
    if (pullFresh && newestFirstSeen != null && nowMs - newestFirstSeen > 7 * 86_400_000) {
      console.log(`  reading: pulls are current and have found nothing new in over a week, so a drought here is REAL`)
    }

    // Velocity inputs, so "why did this say nothing?" is answerable. RECOMPUTED FOR DISPLAY
    // ONLY: the verdict below always comes from detectReviewAnomalies, never from these numbers.
    // Deliberately does not re-encode the gate thresholds (that second copy would drift from the
    // config); it prints the inputs and the thresholds are listed once at the end of the run. If
    // the numbers here ever look like they disagree with the verdict, trust the verdict and treat
    // the disagreement as the finding.
    const DAY = 86_400_000
    const inWin = (from: number, to: number) =>
      reviews.filter((r) => nowMs - r.publishedAtMs >= from * DAY && nowMs - r.publishedAtMs < to * DAY).length
    const vRecent = inWin(0, cfg.velocityRecentDays)
    const vBaseline = inWin(cfg.velocityRecentDays, cfg.velocityRecentDays + cfg.velocityBaselineDays)
    const vExpected = (vBaseline / cfg.velocityBaselineDays) * cfg.velocityRecentDays
    const vRatio = vExpected > 0 ? vRecent / vExpected : 0
    const vZ = Math.abs(anscombeZ(vRecent, vExpected))
    const near = (v: number, t: number) => Math.abs(v - t) / t < 0.1
    const marginal = near(vRatio, cfg.velocityMinRatio) || near(vZ, cfg.velocityZ)
    console.log(
      `  velocity inputs: recent=${vRecent} baseline=${vBaseline} expected=${vExpected.toFixed(2)} ` +
        `ratio=${vRatio.toFixed(3)} |z|=${vZ.toFixed(2)}${marginal ? "   <-- MARGINAL, sits within 10% of a threshold" : ""}`,
    )

    const detected = detectReviewAnomalies({ reviews, nowMs, lastCapturedAtMs, config: cfg })
    const recorded = recordedByLocation.get(loc.id) ?? []
    const cooldowns = recorded
      .map((r) => ({ anomalyKey: r.anomaly_key, cooldownUntilMs: Date.parse(r.cooldown_until) }))
      .filter((r) => Number.isFinite(r.cooldownUntilMs))
    const firing = selectFiringAnomalies(detected, cooldowns, nowMs)

    console.log(`  detected ${detected.length}, suppressed by cooldown ${detected.length - firing.length}, WOULD FIRE ${firing.length}`)

    if (firing.length === 0) {
      console.log("  -> operator sees NOTHING in the watch panel\n")
      continue
    }
    locationsWithSomething++
    totalFiring += firing.length

    // Render exactly what the panel and the digest email would show.
    const asRows: WatchEventRow[] = firing.map((a) => ({
      location_id: loc.id,
      anomaly_key: a.key,
      kind: a.kind,
      direction: a.direction,
      strength: a.strength,
      detail: a.detail as unknown as Record<string, unknown>,
      fired_on: new Date(nowMs).toISOString().slice(0, 10),
      cooldown_until: new Date(cooldownUntilMs(a, nowMs)).toISOString(),
      created_at: new Date(nowMs).toISOString(),
    })) as unknown as WatchEventRow[]

    const notices = buildWatchNotices(asRows)
    const dropped = firing.length - notices.length
    if (dropped > 0) console.log(`  NOTE: ${dropped} anomaly(ies) produced no renderable notice (detail unparseable, dropped by design)`)

    console.log(`\n  ┌─ ${WATCH_COPY.panel.title}`)
    console.log(`  │  ${WATCH_COPY.panel.sub}`)
    for (const n of notices) {
      byKind.set(n.key.split(":")[0], (byKind.get(n.key.split(":")[0]) ?? 0) + 1)
      const flag = n.tone === "attention" ? "!" : "+"
      console.log(`  │`)
      console.log(`  │  [${flag}] ${n.title}${n.when ? `   (${n.when})` : ""}`)
      console.log(`  │      ${n.line}`)
    }
    console.log(`  └─ ${WATCH_COPY.footer}\n`)

    // The audit values, which an operator never sees. Useful for judging whether a threshold fired
    // on a real signal or on noise.
    for (const a of firing) {
      const cd = ((cooldownUntilMs(a, nowMs) - nowMs) / 86_400_000).toFixed(0)
      console.log(`      audit: ${a.key.padEnd(34)} |z|=${a.strength.toFixed(2)}  cooldown ${cd}d`)
    }
    console.log("")
  }

  console.log("═".repeat(100))
  console.log(`${totalFiring} notice(s) would appear across ${locationsWithSomething} of ${locations.length} location(s)`)
  if (byKind.size > 0) {
    console.log("by detector: " + [...byKind.entries()].map(([k, v]) => `${k}=${v}`).join("  "))
  }
  console.log(
    `\nthresholds in use:` +
      `\n  rating   z>=${cfg.ratingZ}, min move ${cfg.ratingMinDeltaStars} stars, needs ${cfg.ratingMinRecent} recent / ${cfg.ratingMinBaseline} baseline` +
      `\n  velocity z>=${cfg.velocityZ}, min ratio ${cfg.velocityMinRatio}, needs ${cfg.velocityMinBaseline} baseline / ${cfg.velocityMinExpected} expected` +
      `\n  cluster  z>=${cfg.clusterZ}, min ${cfg.clusterMinCount} in ${cfg.clusterWindowDays}d`,
  )
  // The detector's inputs arrive on TWO clocks, and the velocity numbers above cannot be read
// without knowing that. Verified 2026-08-21.
console.log(
  `\nhow the corpus is fed:` +
    `\n  DAILY   insights pipeline persists the reviews on the Google Places snapshot.` +
    `\n          That is capped at 5 per location by GOOGLE, not by us, which is why exactly` +
    `\n          5 rows per location get a fresh last_seen_at each night.` +
    `\n  MONDAY  /api/cron/backfill-reviews pulls the newest 50 via Outscraper.` +
    `\n          Schedule "0 8-11 * * 1", 5 locations per run, so up to 20 locations a week.` +
    `\n` +
    `\n  Consequence worth remembering: a location sustaining more than 5 reviews a DAY is` +
    `\n  undercounted between Mondays, which biases velocity toward a false "gone quiet".` +
    `\n  Not reachable at current volume (busiest location runs about 2.4/day). See ALT-742` +
    `\n  for the coverage side once the fleet passes 20 locations.`,
)
console.log("\nNothing was written. Re-run after changing REVIEW_WATCHDOG_CONFIG to compare.\n")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
