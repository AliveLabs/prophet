// DEV/REVIEW-ONLY harness for ALT-231 — "Who's open when": the competitor
// open-hours + busy bar, navigable one day at a time. Renders the real island
// (CompetitorHoursGrid) with realistic MOCK data inside the preview layout's
// `.ticket-app` token surface, so the widget can be reviewed (look + day nav +
// accordion + T-bubble + dark mode + mobile) without an authed session or a live
// data pull. Prod-guarded by the preview layout (VERCEL_ENV !== production).
//
// The mock open hours are real Google-style `weekdayDescriptions` strings run
// through the SAME parser the authed loader uses, so this also exercises the
// production parsing path (breakfast-only, 24h, midnight close, closed days).

import { TkTooltipLayer } from "@/components/ticket"
import CompetitorHoursGrid, {
  type HoursEntity,
  type HoursDay,
} from "@/app/(dashboard)/competitors/competitor-hours-grid"
import { parseWeekdayDescriptions } from "@/lib/competitors/open-hours"
import "@/components/ticket/pass.css"
import "@/app/(dashboard)/competitors/competitors.css"

// ── Deterministic busy curves (24 values, 0–100) — NO randomness, so SSR and the
//    client hydrate identically. Shapes: dinner-led, lunch-led, morning, late-night.
const DINNER = [4, 2, 1, 1, 1, 2, 6, 12, 20, 24, 34, 60, 78, 58, 40, 42, 58, 82, 96, 88, 60, 38, 20, 8]
const LUNCH = [2, 1, 1, 1, 1, 3, 10, 22, 40, 46, 58, 86, 94, 72, 48, 38, 44, 58, 64, 50, 30, 16, 8, 3]
const MORNING = [1, 1, 1, 1, 2, 10, 34, 64, 90, 92, 76, 58, 40, 18, 7, 3, 2, 1, 1, 0, 0, 0, 0, 0]
const LATE = [42, 56, 48, 30, 14, 8, 6, 8, 14, 18, 24, 40, 52, 46, 38, 40, 52, 66, 78, 86, 94, 86, 66, 52]

// Weekend runs a little busier; deterministic per day-of-week (Sun..Sat).
const DAY_FACTOR = [0.86, 0.7, 0.72, 0.78, 0.9, 1.0, 0.96]
function curveFor(base: number[], dow: number): number[] {
  const f = DAY_FACTOR[dow]
  return base.map((v) => Math.min(100, Math.round(v * f)))
}

function mkEntity(
  id: string,
  name: string,
  isYou: boolean,
  weekdayDescriptions: string[] | null,
  busyBase: number[] | null,
): HoursEntity {
  const byDay = parseWeekdayDescriptions(weekdayDescriptions)
  const hoursKnown = Object.values(byDay).some((d) => d.known)
  const days: HoursDay[] = []
  for (let d = 0; d < 7; d++) {
    const h = byDay[d]
    const scores = busyBase ? curveFor(busyBase, d) : null
    if (!h && !scores) continue
    days.push({
      day_of_week: d,
      hours: h ?? { known: false, open: false, is24h: false, intervals: [] },
      hourly_scores: scores,
    })
  }
  return { competitor_id: id, name, isYou, days, hoursKnown }
}

const everyDay = (span: string): string[] =>
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d) => `${d}: ${span}`)

const ENTITIES: HoursEntity[] = [
  // You — open late Fri/Sat, dinner-led crowd.
  mkEntity("__you__", "Wagyu Bar", true, [
    "Sunday: 11:00 AM – 10:00 PM",
    "Monday: 11:00 AM – 11:00 PM",
    "Tuesday: 11:00 AM – 11:00 PM",
    "Wednesday: 11:00 AM – 11:00 PM",
    "Thursday: 11:00 AM – 11:00 PM",
    "Friday: 11:00 AM – 12:00 AM",
    "Saturday: 11:00 AM – 12:00 AM",
  ], DINNER),
  // Standard lunch + dinner rival.
  mkEntity("c-prime", "Prime & Co", false, everyDay("11:00 AM – 10:00 PM"), LUNCH),
  // Breakfast-only — opens early, closes mid-afternoon.
  mkEntity("c-dawn", "Dawn Cafe", false, everyDay("6:00 AM – 2:00 PM"), MORNING),
  // Open 24 hours — late-night crowd is the whole story.
  mkEntity("c-owl", "Night Owl Diner", false, everyDay("Open 24 hours"), LATE),
  // Closed on the default day (Friday) — weekends only.
  mkEntity("c-brunch", "Brunch Club", false, [
    "Sunday: 9:00 AM – 3:00 PM",
    "Monday: Closed",
    "Tuesday: Closed",
    "Wednesday: Closed",
    "Thursday: Closed",
    "Friday: Closed",
    "Saturday: 9:00 AM – 3:00 PM",
  ], MORNING),
  // Hours known, but no busy curve pulled yet — open band, no heat (honest).
  mkEntity("c-new", "The New Spot", false, everyDay("11:00 AM – 9:00 PM"), null),
  // No readable hours at all — shows "hours unavailable" (never fabricated).
  mkEntity("c-mystery", "Mystery Taqueria", false, null, LUNCH),
]

export default function CompetitorHoursPreview() {
  return (
    <div className="pv-page tk-comp">
      <div className="pv-page-head">
        <span className="pv-kicker">ALT-231</span>
        <h1 className="pv-h1">Who&apos;s open when</h1>
        <p className="pv-sub">
          A 24-hour open-hours bar per spot, with the busy curve painted inside the open window
          (quiet → busy). Read one day at a time (step with the arrows or pick a day), and expand
          any spot for its full week. Pure data-viz, so it carries the Ask Ticket bubble.
        </p>
      </div>
      <hr className="pv-rule" />

      <TkTooltipLayer />
      <div className="tk-kit">
        {/* Default day = Friday (5): Brunch Club reads "closed", the rest open. */}
        <CompetitorHoursGrid entities={ENTITIES} todayDow={5} />
      </div>
    </div>
  )
}
