// DEV/REVIEW-ONLY harness for ALT-262 — "Where you stand": the head-to-head
// field-strip scorecard. Renders the real island (CompetitorScorecard) with
// realistic MOCK metrics inside the preview layout's `.ticket-app` token
// surface, so the widget can be reviewed (strips, verdict chips, worst-gap
// ordering, evidence panel + Ask ingress, dark mode, mobile) without an authed
// session. Prod-guarded by the preview layout (VERCEL_ENV !== production).

import { TkTooltipLayer } from "@/components/ticket"
import CompetitorScorecard, {
  type ScorecardMetric,
} from "@/app/(dashboard)/competitors/competitor-scorecard"
import "@/components/ticket/pass.css"
import "@/app/(dashboard)/competitors/competitors.css"

const METRICS: ScorecardMetric[] = [
  {
    key: "reviews",
    label: "Review base",
    you: { id: null, name: "Wagyu Bar", value: 312, display: "312" },
    points: [
      { id: "cfa", name: "Chick-fil-A", value: 4870, display: "4,870" },
      { id: "mcd", name: "McDonald's", value: 3120, display: "3,120" },
      { id: "wtb", name: "Whataburger", value: 1980, display: "1,980" },
      { id: "wen", name: "Wendy's", value: 1240, display: "1,240" },
      { id: "arb", name: "Arby's", value: 860, display: "860" },
    ],
    status: "behind",
    verdict: "Chick-fil-A leads · 4,870 vs your 312",
    confidence: "high",
    evidence: [
      "Chick-fil-A has 4,870 reviews to your 312 — roughly 16× your base. Review volume compounds local visibility.",
      "A review ask at the register or on receipts is the cheapest way to close a base gap.",
    ],
    source: "Google listing profiles",
    href: null,
  },
  {
    key: "visibility",
    label: "Search visibility",
    you: { id: null, name: "Wagyu Bar", value: 480, display: "~480/mo" },
    points: [
      { id: "cfa", name: "Chick-fil-A", value: 720, display: "~720/mo" },
      { id: "wtb", name: "Whataburger", value: 310, display: "~310/mo" },
      { id: "arb", name: "Arby's", value: 120, display: "~120/mo" },
    ],
    status: "behind",
    verdict: "Chick-fil-A leads · ~720/mo vs your ~480/mo",
    confidence: "medium",
    evidence: [
      "Chick-fil-A's site draws an estimated 720/mo visits from search — yours draws 480/mo.",
      "The Visibility page shows which searches they rank for that you don't.",
    ],
    source: "Search ranking data (estimated traffic)",
    href: "/visibility",
  },
  {
    key: "rating",
    label: "Rating",
    you: { id: null, name: "Wagyu Bar", value: 4.6, display: "4.6★" },
    points: [
      { id: "cfa", name: "Chick-fil-A", value: 4.7, display: "4.7★" },
      { id: "wtb", name: "Whataburger", value: 4.2, display: "4.2★" },
      { id: "arb", name: "Arby's", value: 4.0, display: "4.0★" },
      { id: "mcd", name: "McDonald's", value: 3.9, display: "3.9★" },
      { id: "wen", name: "Wendy's", value: 3.8, display: "3.8★" },
    ],
    status: "close",
    verdict: "Chick-fil-A leads · 4.7★ vs your 4.6★",
    confidence: "high",
    evidence: [
      "Chick-fil-A holds 4.7★ — you hold 4.6★. Star gaps this size move which listing gets the tap in local results.",
      "Ratings shift slowly: steady review flow and replies are the honest lever, not a sprint.",
    ],
    source: "Google listing profiles",
    href: null,
  },
  {
    key: "photos",
    label: "Listing photos",
    you: { id: null, name: "Wagyu Bar", value: 86, display: "6/7 covered" },
    points: [
      { id: "cfa", name: "Chick-fil-A", value: 71, display: "5/7 covered" },
      { id: "mcd", name: "McDonald's", value: 57, display: "4/7 covered" },
      { id: "wen", name: "Wendy's", value: 43, display: "3/7 covered" },
    ],
    status: "lead",
    verdict: "You lead · 6/7 covered vs Chick-fil-A's 5/7 covered",
    confidence: "medium",
    evidence: [],
    source: "Google listing photos, vision-analyzed",
    href: "/photos",
  },
  {
    key: "social",
    label: "Social engagement",
    you: { id: null, name: "Wagyu Bar", value: 3.1, display: "3.1%" },
    points: [
      { id: "wtb", name: "Whataburger", value: 1.9, display: "1.9%" },
      { id: "cfa", name: "Chick-fil-A", value: 1.7, display: "1.7%" },
      { id: "mcd", name: "McDonald's", value: 0.9, display: "0.9%" },
    ],
    status: "lead",
    verdict: "You lead · 3.1% vs Whataburger's 1.9%",
    confidence: "medium",
    evidence: [],
    source: "Social profiles, latest pull",
    href: "/social",
  },
]

export default function CompetitorScorecardPreview() {
  return (
    <div className="pv-page tk-comp">
      <div className="pv-page-head">
        <span className="pv-kicker">ALT-262</span>
        <h1 className="pv-h1">Where you stand</h1>
        <p className="pv-sub">
          The field-strip scorecard: every rival a dot on the same scale, you as the patina marker.
          Worst gap first; a behind-row expands into the evidence panel with the Ask Ticket ingress.
        </p>
      </div>
      <hr className="pv-rule" />
      <TkTooltipLayer />
      <CompetitorScorecard metrics={METRICS} ownName="Wagyu Bar" />
    </div>
  )
}
