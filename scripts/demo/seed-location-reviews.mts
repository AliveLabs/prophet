// Seed realistic, PRE-SCORED demo reviews for the Review Intelligence surface (/reviews).
// For demo/beta-prep use against a DEMO location only — rows are tagged source='demo_seed'
// so they can never collide with real google_places rows and can be wiped cleanly.
//
//   npx tsx scripts/demo/seed-location-reviews.mts --location-id <uuid>          # seed
//   npx tsx scripts/demo/seed-location-reviews.mts --location-id <uuid> --wipe   # remove seeds
//
// Auth/ref conventions match scripts/db/sql.mts exactly (SUPABASE_ACCESS_TOKEN from env or
// .env.local; project ref from supabase/.temp/linked-project.json) — this is a Management
// API write to the LINKED project, so treat it with the same care as a migration run.
//
// The mix is deliberate: mostly ordinary genuine reviews (the surface must feel calm, not
// alarmist), one crisis-grade red flag ("needs you personally"), one suspect repeat-negative
// author (the "doesn't add up" section), and two unscored rows (the "still reading" state).

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

function loadToken(): string {
  const token = process.env.SUPABASE_ACCESS_TOKEN || fromEnvLocal("SUPABASE_ACCESS_TOKEN")
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN not found in env or .env.local")
  return token
}

function loadProjectRef(): string {
  const raw = readFileSync(resolve(REPO_ROOT, "supabase/.temp/linked-project.json"), "utf8")
  // The linked-project file's key is `ref` (see sql.mts's twin loader); accept
  // `projectRef` too in case the CLI ever renames it.
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
  console.error("Usage: npx tsx scripts/demo/seed-location-reviews.mts --location-id <uuid> [--wipe]")
  process.exit(1)
}
const wipe = process.argv.includes("--wipe")

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

type Seed = {
  id: string
  author: string
  rating: number
  text: string
  publishedDaysAgo: number
  relative: string
  score?: {
    auth: number
    authConf: "low" | "medium" | "high"
    authWhy: string
    sev: number
    sevWhy: string
    redFlags?: string[]
  }
  authorKeyOverride?: string
}

const SEEDS: Seed[] = [
  {
    id: "demo-001", author: "Marcus T.", rating: 5, publishedDaysAgo: 1, relative: "a day ago",
    text: "Been coming here every Friday for two years. Tenders are always fresh, sweet tea is perfect, and the ladies at the window know my order before I say it. Best in town, hands down.",
    score: { auth: 96, authConf: "high", authWhy: "Specific repeat-visit details and staff familiarity read like a genuine regular.", sev: 4, sevWhy: "No complaint, strong praise." },
  },
  {
    id: "demo-002", author: "Danielle R.", rating: 2, publishedDaysAgo: 2, relative: "2 days ago",
    text: "Waited 25 minutes in the drive thru tonight and my rolls were hard as a rock when I finally got home. The tenders were fine but y'all have to do better on those wait times.",
    score: { auth: 92, authConf: "high", authWhy: "Concrete visit details with a specific, fixable complaint.", sev: 46, sevWhy: "Real service failure on wait time and food quality, worth a direct reply." },
  },
  {
    id: "demo-003", author: "J. Whitfield", rating: 1, publishedDaysAgo: 3, relative: "3 days ago",
    text: "My daughter and I both had stomach cramps all night after eating here yesterday. Pretty sure it was the gravy. Somebody needs to check that kitchen before someone ends up in the hospital.",
    score: { auth: 78, authConf: "medium", authWhy: "Reads like a firsthand account with a timeline, though illness cause is asserted, not established.", sev: 92, sevWhy: "Illness claim tied to a specific visit. This needs the owner, not a template.", redFlags: ["illness"] },
  },
  {
    id: "demo-004", author: "Brianna K.", rating: 4, publishedDaysAgo: 4, relative: "4 days ago",
    text: "Solid as always. Only reason it's not 5 stars is the lobby was out of ice and nobody seemed to notice for a while. Food came out hot and fast though.",
    score: { auth: 95, authConf: "high", authWhy: "Balanced praise with one small specific gripe, classic genuine review shape.", sev: 18, sevWhy: "Minor operational note, a thank-you and a fix mention covers it." },
  },
  {
    id: "demo-005", author: "TruthTeller214", rating: 1, publishedDaysAgo: 5, relative: "5 days ago",
    text: "Absolute worst restaurant in the metroplex. Everything about this place is a disgrace. Do not spend a single dollar here. You have been warned.",
    score: { auth: 22, authConf: "medium", authWhy: "No visit details at all, pure denunciation. Same account has left other all-negative reviews here.", sev: 38, sevWhy: "Hostile but generic, nothing actionable named." },
    authorKeyOverride: "name:truthteller214",
  },
  {
    id: "demo-006", author: "TruthTeller214", rating: 1, publishedDaysAgo: 6, relative: "6 days ago",
    text: "Came back to say it again since my last review disappeared. Trash food, trash service. Zero stars if I could.",
    score: { auth: 14, authConf: "high", authWhy: "Repeat all-negative reviews in a short burst from the same account, no visit specifics either time.", sev: 30, sevWhy: "Generic hostility, no specific failure to address." },
    authorKeyOverride: "name:truthteller214",
  },
  {
    id: "demo-007", author: "Robert G.", rating: 3, publishedDaysAgo: 8, relative: "a week ago",
    text: "Food is good but prices have crept up quite a bit this year. Family of five is pushing fifty dollars now. Still better than the other chicken places nearby but keep an eye on it.",
    score: { auth: 94, authConf: "high", authWhy: "Specific, measured, comparative. Genuine regular weighing value.", sev: 24, sevWhy: "Price sensitivity worth acknowledging, no service failure." },
  },
  {
    id: "demo-008", author: "Ashley M.", rating: 1, publishedDaysAgo: 9, relative: "a week ago",
    text: "The young man at the register was flat out rude to my elderly mother, rolled his eyes and mumbled when she asked him to repeat the total. We won't be back until someone teaches that crew some manners.",
    score: { auth: 88, authConf: "high", authWhy: "Specific interaction with concrete detail, reads like a real visit.", sev: 68, sevWhy: "Staff conduct complaint involving an elderly customer. Deserves a personal reply and likely a make-good." },
  },
  {
    id: "demo-009", author: "Carlos V.", rating: 5, publishedDaysAgo: 12, relative: "2 weeks ago",
    text: "Ordered 40 tenders for my son's team after the game and they had it ready right on time, boxed by flavor, with extra sauces thrown in. That's how you earn a customer for life.",
    score: { auth: 97, authConf: "high", authWhy: "Detailed catering story, unmistakably genuine.", sev: 3, sevWhy: "Praise, a warm thank-you keeps the momentum." },
  },
  {
    id: "demo-010", author: "Patricia H.", rating: 2, publishedDaysAgo: 15, relative: "2 weeks ago",
    text: "Third time in a row my order was missing something. Tonight it was the okra. Check your bags before you drive off, folks. Sweet tea still the best around though.",
    // sev 68 lands above the default-threshold discount cut (66), so the card's
    // recommendation tier AND this rationale agree ("Consider a discount").
    score: { auth: 93, authConf: "high", authWhy: "Repeat customer with a specific recurring failure, ends with genuine praise.", sev: 68, sevWhy: "Recurring order accuracy problem for a loyal customer. A make-good likely retains her." },
  },
  { id: "demo-011", author: "Denise W.", rating: 4, publishedDaysAgo: 0, relative: "an hour ago",
    text: "Stopped in on my lunch break, line moved quick and the chicken was crispy. Bathroom could use some attention but otherwise a good stop." },
  { id: "demo-012", author: "Tony B.", rating: 1, publishedDaysAgo: 0, relative: "2 hours ago",
    text: "Ordered online, said 15 minutes, took 40. Nobody apologized, nobody explained. I get that y'all are busy but at least say something." },
]

function sqlLit(v: string | number | null): string {
  if (v === null) return "null"
  if (typeof v === "number") return String(v)
  return `'${v.replace(/'/g, "''")}'`
}

function buildSql(): string {
  if (wipe) {
    return `delete from public.location_reviews where location_id = ${sqlLit(locationId!)} and source = 'demo_seed';`
  }
  const rows = SEEDS.map((s) => {
    const authorKey = s.authorKeyOverride ?? `name:${s.author.trim().toLowerCase().replace(/\s+/g, " ")}`
    const scored = s.score
    return `(${[
      sqlLit(locationId!), "'demo_seed'", sqlLit(s.id), sqlLit(s.author), sqlLit(authorKey),
      sqlLit(s.rating), sqlLit(s.text), sqlLit(daysAgo(s.publishedDaysAgo)), sqlLit(s.relative),
      scored ? sqlLit(scored.auth) : "null",
      scored ? sqlLit(scored.authConf) : "null",
      scored ? sqlLit(scored.authWhy) : "null",
      scored ? sqlLit(scored.sev) : "null",
      scored ? sqlLit(scored.sevWhy) : "null",
      scored?.redFlags ? `'${JSON.stringify(scored.redFlags)}'::jsonb` : "null",
      scored ? "now()" : "null",
      scored ? "'demo-seed-v1'" : "null",
    ].join(", ")})`
  }).join(",\n  ")
  return `insert into public.location_reviews
  (location_id, source, source_review_id, author_name, author_key, rating, review_text,
   published_at, relative_published, authenticity_score, authenticity_confidence,
   authenticity_rationale, severity_score, severity_rationale, red_flags, scored_at, score_version)
values
  ${rows}
on conflict (location_id, source, source_review_id) do update set
  review_text = excluded.review_text,
  authenticity_score = excluded.authenticity_score,
  authenticity_confidence = excluded.authenticity_confidence,
  authenticity_rationale = excluded.authenticity_rationale,
  severity_score = excluded.severity_score,
  severity_rationale = excluded.severity_rationale,
  red_flags = excluded.red_flags,
  scored_at = excluded.scored_at,
  score_version = excluded.score_version,
  last_seen_at = now(),
  updated_at = now();`
}

async function main() {
  const token = loadToken()
  const ref = loadProjectRef()
  const sql = buildSql()
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  if (!res.ok) {
    console.error(`Seed ${wipe ? "wipe" : "insert"} FAILED (${res.status}): ${body}`)
    process.exit(1)
  }
  console.log(wipe ? `Wiped demo_seed reviews for ${locationId}.` : `Seeded ${SEEDS.length} demo reviews for ${locationId} (2 unscored on purpose).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
