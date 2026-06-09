// ---------------------------------------------------------------------------
// Production Trust Audit  (READ-ONLY)
//
// Signal-by-signal freshness/integrity ledger for a Ticket/Prophet Supabase DB.
// Answers: "Is the data real and current, or stale-stamped-fresh?" — per
// provider, per org — plus a pipeline-coverage map.
//
// SAFETY: this script issues ONLY `.select()` reads. It never inserts,
// updates, upserts, deletes, or RPCs. It prints a markdown report to stdout.
//
// USAGE:
//   SUPA_URL=https://<ref>.supabase.co SUPA_KEY=<service_role_or_readonly> \
//     node scripts/audit/prod-trust-audit.mjs > docs/engine-rewrite/<name>.md
//
// It logs which DB host it is hitting so there is never ambiguity about
// whether you are auditing prod or the branch.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPA_URL
const KEY = process.env.SUPA_KEY
if (!URL || !KEY) {
  console.error("Missing SUPA_URL / SUPA_KEY env vars")
  process.exit(1)
}
const REF = (URL.match(/https:\/\/([^.]+)\./) ?? [])[1] ?? "unknown"

const db = createClient(URL, KEY, { auth: { persistSession: false } })

const NOW = new Date()
const out = []
const p = (s = "") => out.push(s)

// --- helpers ---------------------------------------------------------------

function ageDays(fromIso, toIso) {
  const a = new Date(fromIso).getTime()
  const b = new Date(toIso ?? NOW.toISOString()).getTime()
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

// Pull a post's real publish date from whatever shape the row uses.
function postDate(post) {
  const raw =
    post?.createdTime ?? post?.created_time ?? post?.taken_at ?? post?.date ?? null
  if (raw != null && typeof raw === "string") return raw
  const ts = post?.timestamp ?? post?.taken_at_timestamp ?? null
  if (typeof ts === "number") return new Date(ts * 1000).toISOString()
  return null
}

function newestPostDate(raw) {
  const posts = raw?.recentPosts ?? raw?.recent_posts ?? []
  const dates = posts.map(postDate).filter(Boolean).map((d) => new Date(d).getTime())
  if (!dates.length) return null
  return new Date(Math.max(...dates)).toISOString()
}

// Page through a table read-only; report (and cap) volume honestly.
async function selectAll(table, columns, { cap = 5000, order } = {}) {
  const PAGE = 1000
  let from = 0
  const rows = []
  for (;;) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1)
    if (order) q = q.order(order.col, { ascending: order.asc ?? false })
    const { data, error } = await q
    if (error) return { rows, error }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE || rows.length >= cap) break
    from += PAGE
  }
  return { rows, capped: rows.length >= cap }
}

function bucket(days) {
  if (days == null) return "no-date"
  if (days <= 30) return "fresh (≤30d)"
  if (days <= 90) return "aging (31–90d)"
  if (days <= 365) return "stale (91–365d)"
  return "ancient (>365d)"
}

function tally(items, keyFn) {
  const m = new Map()
  for (const it of items) {
    const k = keyFn(it)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

// --- report ----------------------------------------------------------------

p(`# Production Trust Audit — ${REF}`)
p()
p(`> Read-only. Generated against \`${URL}\` at ${NOW.toISOString()}.`)
p(`> Buckets compare content publish-date vs the row's \`captured_at\` (the "as-of" the system claims).`)
p()

// ORGS + trial/tier (who actually gets pipeline runs)
{
  const { rows: orgs, error } = await selectAll(
    "organizations",
    "id,name,subscription_tier,trial_ends_at,created_at"
  )
  p(`## Organizations — who the daily cron actually serves`)
  if (error) { p(`_error: ${error.message}_`); }
  else {
    const active = orgs.filter((o) => {
      const t = o.trial_ends_at ? new Date(o.trial_ends_at).getTime() : 0
      const paid = o.subscription_tier && !["free", null].includes(o.subscription_tier)
      return paid || t > NOW.getTime()
    })
    const expired = orgs.filter((o) => !active.includes(o))
    p(`Total **${orgs.length}** · would-run **${active.length}** · skipped (trial expired / no sub) **${expired.length}**`)
    p()
    p(`| org | tier | trial_ends | runs? |`)
    p(`|---|---|---|---|`)
    for (const o of orgs) {
      const runs = active.includes(o) ? "✅" : "⛔ skipped"
      p(`| ${o.name ?? o.id} | ${o.subscription_tier ?? "null"} | ${o.trial_ends_at ?? "—"} | ${runs} |`)
    }
  }
  p()
}

// SOCIAL — the headline integrity check
{
  const { rows: profiles } = await selectAll(
    "social_profiles",
    "id,entity_type,entity_id,platform,handle,is_verified,discovery_method,updated_at"
  )
  const profById = new Map(profiles.map((x) => [x.id, x]))
  const { rows: snaps, error, capped } = await selectAll(
    "social_snapshots",
    "social_profile_id,date_key,captured_at,raw_data",
    { order: { col: "captured_at", asc: false } }
  )
  p(`## Social (Data365) — content age vs capture stamp  ← the headline check`)
  if (error) { p(`_error: ${error.message}_`) }
  else {
    if (capped) p(`> ⚠️ capped at read limit — volume exceeds cap, numbers are a floor.`)
    const ledger = snaps.map((s) => {
      const newest = newestPostDate(s.raw_data)
      const contentAge = newest ? ageDays(newest, s.captured_at) : null
      const prof = profById.get(s.social_profile_id)
      return {
        platform: prof?.platform ?? "?",
        handle: prof?.handle ?? "?",
        verified: prof?.verified ?? prof?.is_verified,
        method: prof?.discovery_method,
        captured: (s.captured_at ?? "").slice(0, 10),
        newest: newest ? newest.slice(0, 10) : "none",
        contentAge,
        bucket: bucket(contentAge),
      }
    })
    p(`**${ledger.length}** social snapshots analyzed.`)
    p()
    p(`Freshness of newest post inside each snapshot (vs when we "captured" it):`)
    p()
    p(`| bucket | count |`); p(`|---|---|`)
    for (const [k, n] of tally(ledger, (x) => x.bucket)) p(`| ${k} | ${n} |`)
    p()
    const bad = ledger.filter((x) => x.contentAge != null && x.contentAge > 90).sort((a, b) => b.contentAge - a.contentAge)
    p(`### Worst offenders — "captured" recently but newest content is >90 days old (top 25)`)
    p(`| platform | handle | captured | newest post | content age (days) | verified | method |`)
    p(`|---|---|---|---|---|---|---|`)
    for (const x of bad.slice(0, 25)) {
      p(`| ${x.platform} | ${x.handle} | ${x.captured} | ${x.newest} | **${x.contentAge}** | ${x.verified} | ${x.method} |`)
    }
    p()
    // Unverified / suspicious handles
    const unver = profiles.filter((x) => !(x.is_verified ?? x.verified))
    p(`### Discovery quality`)
    p(`Profiles: **${profiles.length}** · verified **${profiles.length - unver.length}** · unverified **${unver.length}**`)
    p(`By discovery method: ${tally(profiles, (x) => x.discovery_method ?? "?").map(([k, n]) => `${k}=${n}`).join(" · ")}`)
  }
  p()
}

// COMPETITOR LISTING SNAPSHOTS (DataForSEO my_business_info)
{
  const { rows, error } = await selectAll(
    "snapshots",
    "competitor_id,provider,snapshot_type,date_key,captured_at",
    { order: { col: "captured_at", asc: false } }
  )
  p(`## Competitor snapshots (Google listing / SEO labs)`)
  if (error) { p(`_error: ${error.message}_`) }
  else {
    p(`**${rows.length}** rows. Freshness of \`captured_at\` vs now:`)
    p(`| bucket | count |`); p(`|---|---|`)
    for (const [k, n] of tally(rows, (x) => bucket(ageDays(x.captured_at)))) p(`| ${k} | ${n} |`)
    p()
    p(`By snapshot_type (newest captured_at):`)
    p(`| type | count | newest |`); p(`|---|---|---|`)
    const byType = new Map()
    for (const r of rows) {
      const e = byType.get(r.snapshot_type) ?? { n: 0, newest: "" }
      e.n++; if ((r.captured_at ?? "") > e.newest) e.newest = r.captured_at ?? ""
      byType.set(r.snapshot_type, e)
    }
    for (const [t, e] of [...byType.entries()].sort((a, b) => b[1].n - a[1].n)) {
      p(`| ${t} | ${e.n} | ${(e.newest ?? "").slice(0, 10)} |`)
    }
  }
  p()
}

// LOCATION SNAPSHOTS (events, weather, SEO, firecrawl) — coverage + freshness
{
  const { rows, error } = await selectAll(
    "location_snapshots",
    "location_id,provider,date_key,captured_at"
  )
  p(`## Location signals (events / weather / SEO / menu) — coverage & freshness`)
  if (error) { p(`_error: ${error.message}_`) }
  else {
    const byProv = new Map()
    for (const r of rows) {
      const e = byProv.get(r.provider) ?? { n: 0, newest: "", locs: new Set() }
      e.n++; e.locs.add(r.location_id); if ((r.date_key ?? "") > e.newest) e.newest = r.date_key ?? ""
      byProv.set(r.provider, e)
    }
    p(`| provider | rows | locations | newest date_key | age (days) |`)
    p(`|---|---|---|---|---|`)
    for (const [prov, e] of [...byProv.entries()].sort((a, b) => (a[1].newest < b[1].newest ? 1 : -1))) {
      p(`| ${prov} | ${e.n} | ${e.locs.size} | ${e.newest} | ${ageDays(e.newest)} |`)
    }
  }
  p()
}

// INSIGHTS freshness + type mix
{
  const { rows, error } = await selectAll(
    "insights",
    "location_id,competitor_id,date_key,insight_type,status,created_at",
    { order: { col: "date_key", asc: false } }
  )
  p(`## Insights — freshness & composition`)
  if (error) { p(`_error: ${error.message}_`) }
  else {
    p(`**${rows.length}** insights. date_key range ${rows.at(-1)?.date_key} → ${rows[0]?.date_key}.`)
    p()
    p(`Freshness (date_key vs now):`)
    p(`| bucket | count |`); p(`|---|---|`)
    for (const [k, n] of tally(rows, (x) => bucket(ageDays(x.date_key)))) p(`| ${k} | ${n} |`)
    p()
    p(`Top insight_type:`)
    p(`| type | count |`); p(`|---|---|`)
    for (const [t, n] of tally(rows, (x) => x.insight_type).slice(0, 20)) p(`| ${t} | ${n} |`)
  }
  p()
}

// REFRESH JOB HISTORY — did the pipeline actually run?
{
  const { rows, error } = await selectAll(
    "refresh_jobs",
    "location_id,job_type,status,created_at,updated_at",
    { order: { col: "created_at", asc: false } }
  )
  p(`## Pipeline run history (refresh_jobs)`)
  if (error) { p(`_error (table may not exist on this DB): ${error.message}_`) }
  else if (!rows.length) p(`No refresh_jobs rows — the tracked pipeline has not run (or history was pruned).`)
  else {
    p(`**${rows.length}** job records. Most recent: ${rows[0]?.created_at}.`)
    p(`Status mix: ${tally(rows, (x) => x.status).map(([k, n]) => `${k}=${n}`).join(" · ")}`)
    p(`By type: ${tally(rows, (x) => x.job_type).map(([k, n]) => `${k}=${n}`).join(" · ")}`)
    p()
    p(`| when | type | status | location |`); p(`|---|---|---|---|`)
    for (const r of rows.slice(0, 15)) {
      p(`| ${(r.created_at ?? "").slice(0, 16)} | ${r.job_type} | ${r.status} | ${(r.location_id ?? "").slice(0, 8)} |`)
    }
  }
  p()
}

console.log(out.join("\n"))
