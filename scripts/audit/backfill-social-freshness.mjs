// Backfill content_as_of + freshness on existing social_snapshots (READ + UPDATE).
// Mirrors lib/freshness (social: fresh≤30d, aging≤90d, else dormant; empty/undated).
// Run: set -a; . ./.env.local; set +a; node scripts/audit/backfill-social-freshness.mjs
import { createClient } from "@supabase/supabase-js"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error("missing env"); process.exit(1) }
if (!URL.includes("eguflqjnodumjbmdxrnj")) { console.error(`refusing: ${URL} is not the branch`); process.exit(2) }
const db = createClient(URL, KEY, { auth: { persistSession: false } })

function postDate(p) {
  for (const f of ["createdTime", "created_time", "taken_at", "date"]) if (typeof p?.[f] === "string" && p[f].trim()) return p[f]
  const ts = p?.timestamp ?? p?.taken_at_timestamp
  if (typeof ts === "number" && ts > 0) return new Date(ts < 1e12 ? ts * 1000 : ts).toISOString()
  return null
}
function socialContentAsOf(raw) {
  const posts = raw?.recentPosts ?? raw?.recent_posts ?? raw?.data?.items ?? []
  if (!Array.isArray(posts) || posts.length === 0) return { contentAsOf: null, isEmpty: true }
  const t = posts.map(postDate).filter(Boolean).map((d) => Date.parse(d)).filter((n) => !isNaN(n))
  return t.length ? { contentAsOf: new Date(Math.max(...t)).toISOString(), isEmpty: false } : { contentAsOf: null, isEmpty: false }
}
function classifyAtCapture(contentAsOf, capturedAt, isEmpty) {
  if (isEmpty) return "empty"
  if (!contentAsOf) return "undated"
  const age = Math.round((Date.parse(capturedAt) - Date.parse(contentAsOf)) / 86_400_000)
  if (isNaN(age)) return "undated"
  if (age <= 30) return "fresh"
  if (age <= 90) return "aging"
  return "dormant"
}

const { data: rows, error } = await db.from("social_snapshots").select("id, raw_data, captured_at, date_key")
if (error) { console.error(error.message); process.exit(1) }

let updated = 0
const tally = {}
for (const r of rows ?? []) {
  const { contentAsOf, isEmpty } = socialContentAsOf(r.raw_data)
  const capturedAt = r.captured_at ?? `${r.date_key}T00:00:00Z`
  const freshness = classifyAtCapture(contentAsOf, capturedAt, isEmpty)
  tally[freshness] = (tally[freshness] ?? 0) + 1
  const { error: uErr } = await db.from("social_snapshots").update({ content_as_of: contentAsOf, freshness }).eq("id", r.id)
  if (!uErr) updated++
}
console.log(`backfilled ${updated}/${(rows ?? []).length} social_snapshots`)
console.log("freshness tally:", JSON.stringify(tally))
