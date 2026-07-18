// Backfill REAL Google review history for a location via Outscraper (the same
// vendor already used for busy-times — no customer auth, consistent with the
// D6 decision: Ticket never makes customers authenticate to outside tools).
//
//   npx tsx scripts/ops/backfill-reviews.mts --location-id <uuid>              # newest 60
//   npx tsx scripts/ops/backfill-reviews.mts --location-id <uuid> --limit 120  # deeper
//
// Why this exists: the Google Places details feed caps at 5 "most relevant"
// reviews per fetch, so the daily capture corpus grows slowly and skews
// positive. This pulls the location's actual recent history (negatives
// included) in one shot.
//
// DEDUP IS EXACT, verified 2026-07-17 on Bush's Forney: Outscraper's review_id
// is byte-identical to the {reviewId} suffix of the Places resource name we
// already store, so rows are written under source='google_places' with
// source_review_id = places/{placeId}/reviews/{review_id} — the same key the
// daily capture upserts. Existing rows are left untouched (ON CONFLICT only
// bumps last_seen_at); their scores and triage state survive.
//
// author_key mirrors the Places capture form exactly
// (uri:https://www.google.com/maps/contrib/{author_id}/reviews) so reviewer
// identities do not split across the two capture paths.
//
// New rows land UNSCORED. Scoring runs via the normal pipeline: enqueue the
// location's insights job + drain the worker (scoreLocationReviews picks up
// unscored rows, 60/run, chunked 15/call).
//
// Auth/ref conventions match scripts/db/sql.mts (Management API, linked ref).
//
// MANUAL ops one-off. The AUTOMATED weekly path is /api/cron/backfill-reviews
// (lib/jobs/backfill/reviews-refresh), and the canonical fetch+normalize now lives
// in lib/providers/outscraper#fetchLocationReviews. This script keeps its own inline
// copy on purpose: it runs standalone via tsx (no @/ alias resolution) and writes via
// the Management API because local .env.local may point at a non-prod project. Keep
// this normalization in sync with fetchLocationReviews if you change either.

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

function fromEnvLocal(key: string): string | undefined {
  try {
    const env = readFileSync(resolve(REPO_ROOT, ".env.local"), "utf8")
    const m = env.match(new RegExp(`^${key}=(.*)$`, "m"))
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined
  } catch {
    return undefined
  }
}

function required(name: string): string {
  const v = process.env[name] || fromEnvLocal(name)
  if (!v || v === "xxx") throw new Error(`${name} not found in env or .env.local`)
  return v
}

function loadProjectRef(): string {
  const raw = readFileSync(resolve(REPO_ROOT, "supabase/.temp/linked-project.json"), "utf8")
  const parsed = JSON.parse(raw) as { ref?: string; projectRef?: string }
  const ref = parsed.ref ?? parsed.projectRef
  if (!ref) throw new Error("ref missing from supabase/.temp/linked-project.json")
  return ref
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const locationId = arg("--location-id")
if (!locationId || !/^[0-9a-f-]{36}$/i.test(locationId)) {
  console.error("Usage: npx tsx scripts/ops/backfill-reviews.mts --location-id <uuid> [--limit 60]")
  process.exit(1)
}
const limit = Math.min(250, Math.max(1, Number(arg("--limit") ?? 60)))

function sqlLit(v: string | number | null): string {
  if (v === null) return "null"
  if (typeof v === "number") return String(v)
  return `'${v.replace(/'/g, "''")}'`
}

async function pgQuery(token: string, ref: string, query: string): Promise<unknown[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Management API query failed (${res.status}): ${body}`)
  return JSON.parse(body) as unknown[]
}

type OutscraperReview = {
  review_id?: string
  review_rating?: number
  review_text?: string
  review_datetime_utc?: string // "07/12/2026 19:03:22" (US format, UTC)
  review_timestamp?: number // unix seconds — preferred over parsing the string
  review_link?: string
  author_title?: string
  author_id?: string
}

async function main() {
  const token = required("SUPABASE_ACCESS_TOKEN")
  const outscraperKey = required("OUTSCRAPER_API_KEY")
  const ref = loadProjectRef()

  // 1. Resolve the location's place id.
  const locRows = (await pgQuery(
    token,
    ref,
    `select primary_place_id from locations where id = ${sqlLit(locationId!)}`,
  )) as Array<{ primary_place_id: string | null }>
  const placeId = locRows[0]?.primary_place_id
  if (!placeId) throw new Error(`Location ${locationId} not found or has no primary_place_id`)

  // 2. Pull newest N real reviews from Outscraper (sync mode).
  console.log(`Fetching newest ${limit} reviews for place ${placeId} via Outscraper...`)
  const url = `https://api.app.outscraper.com/maps/reviews-v3?query=${encodeURIComponent(placeId)}&reviewsLimit=${limit}&sort=newest&async=false`
  const res = await fetch(url, { headers: { "X-API-KEY": outscraperKey } })
  if (!res.ok) throw new Error(`Outscraper ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const payload = (await res.json()) as { data?: Array<{ reviews_data?: OutscraperReview[]; reviews?: number; name?: string }> }
  const place = payload.data?.[0]
  const reviews = (place?.reviews_data ?? []).filter((r) => r.review_id)
  console.log(`Listing "${place?.name}" has ${place?.reviews ?? "?"} total reviews; fetched ${reviews.length}.`)
  if (reviews.length === 0) {
    console.log("Nothing to backfill.")
    return
  }

  // 3. Insert under the SAME key space as the daily Places capture. Existing
  //    rows (already captured/scored) are untouched apart from last_seen_at.
  const now = new Date().toISOString()
  const rows = reviews.map((r) => {
    const sourceReviewId = `places/${placeId}/reviews/${r.review_id}`
    const authorName = (r.author_title ?? "").trim() || null
    const authorKey = r.author_id
      ? `uri:https://www.google.com/maps/contrib/${r.author_id}/reviews`
      : authorName
        ? `name:${authorName.toLowerCase().replace(/\s+/g, " ")}`
        : null
    const rating =
      typeof r.review_rating === "number" && r.review_rating >= 1 && r.review_rating <= 5
        ? Math.round(r.review_rating)
        : null
    const publishedAt =
      typeof r.review_timestamp === "number" && r.review_timestamp > 0
        ? new Date(r.review_timestamp * 1000).toISOString()
        : null
    return `(${[
      sqlLit(locationId!),
      "'google_places'",
      sqlLit(sourceReviewId),
      sqlLit(authorName),
      sqlLit(authorKey),
      sqlLit(rating),
      sqlLit((r.review_text ?? "").trim() || null),
      sqlLit(publishedAt),
      "null", // relative_published: unknown here; the UI falls back to the absolute date
      sqlLit(r.review_link ?? null),
      sqlLit(now),
      sqlLit(now),
    ].join(", ")})`
  })

  const sql = `insert into public.location_reviews
  (location_id, source, source_review_id, author_name, author_key, rating, review_text,
   published_at, relative_published, google_maps_uri, last_seen_at, updated_at)
values
  ${rows.join(",\n  ")}
on conflict (location_id, source, source_review_id) do update set
  last_seen_at = excluded.last_seen_at;`

  await pgQuery(token, ref, sql)

  const counts = (await pgQuery(
    token,
    ref,
    `select count(*) as total, count(scored_at) as scored, count(*) filter (where rating <= 2) as negative
     from location_reviews where location_id = ${sqlLit(locationId!)}`,
  )) as Array<{ total: number; scored: number; negative: number }>
  console.log(
    `Done. Corpus for ${locationId}: ${counts[0].total} reviews (${counts[0].negative} negative), ${counts[0].scored} scored.`,
  )
  console.log("Next: enqueue the location's insights job + run the worker so the new rows get scored.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
