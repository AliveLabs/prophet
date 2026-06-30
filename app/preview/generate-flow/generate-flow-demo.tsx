"use client"

// DEV/REVIEW-ONLY playback of the ALT-230 "Generate insight" result UX. The live
// endpoint needs auth + a Gemini key, so this reproduces the on-/insights states with
// the REAL components + CSS (InsightCardKit, the .tk-sweep placeholder, the "Just
// generated" marker + rust ring) so the review matches what ships. The data is mocked;
// the presentation is production code.

import { useState } from "react"
import { TkToastProvider } from "@/components/ticket"
import { InsightCardKit } from "@/app/(dashboard)/insights/insight-card-kit"
import type { FeedInsight } from "@/app/(dashboard)/insights/insights-feed-kit"

// The freshly generated insight (what the Gemini endpoint returns for a weather card).
const GENERATED: FeedInsight = {
  id: "demo-generated",
  title: "A warm, dry week should lift your afternoon foot traffic",
  summary:
    "An average high of 72°F with no severe days usually means busier afternoons. Plan to be ready for a steady walk-in bump, especially over the weekend.",
  insightType: "user_viz.weather.demo1234",
  competitorId: null,
  confidence: "medium",
  severity: "info",
  status: "new",
  userFeedback: null,
  relevanceScore: 24, // info(30) x medium(0.8) — honest + low, settles into rank on refresh
  urgencyLevel: "info",
  suppressed: false,
  evidence: {},
  recommendations: [
    { title: "Make outdoor seating obvious this weekend", rationale: "Clear, mild days pull in walk-in traffic when seating is visible from the street." },
    { title: "Add an extra afternoon hand Friday to Sunday", rationale: "Demand skews to warm afternoons, so you are covered at the busiest stretch." },
  ],
  subjectLabel: "Your location",
  dateKey: "2026-06-30",
  justGenerated: true,
}

// A couple of existing pool insights, so the pinned card is clearly at the TOP of the pool.
const POOL: FeedInsight[] = [
  {
    id: "demo-pool-1",
    title: "Your rating is climbing while two nearby rivals slip",
    summary: "You are at 4.6 stars and rising; two competitors in your set dropped this month. Worth pressing the advantage.",
    insightType: "review.sentiment_shift",
    competitorId: null,
    confidence: "high",
    severity: "warning",
    status: "new",
    userFeedback: null,
    relevanceScore: 60,
    urgencyLevel: "warning",
    suppressed: false,
    evidence: { location_rating: 4.6, review_count: 312 },
    recommendations: [{ title: "Ask happy regulars for a quick review", rationale: "You have momentum; a few more reviews widens the gap." }],
    subjectLabel: "Your location",
    dateKey: "2026-06-30",
  },
  {
    id: "demo-pool-2",
    title: "A competitor's short video is outperforming their usual posts",
    summary: "One rival's recent reel is getting well above their normal engagement. Worth a look at what is landing.",
    insightType: "social.follower_spike",
    competitorId: null,
    confidence: "medium",
    severity: "info",
    status: "new",
    userFeedback: null,
    relevanceScore: 24,
    urgencyLevel: "info",
    suppressed: false,
    evidence: {},
    recommendations: [],
    subjectLabel: "Rival Co",
    dateKey: "2026-06-30",
  },
]

type Phase = "idle" | "generating" | "done"

export function GenerateFlowDemo() {
  const [phase, setPhase] = useState<Phase>("idle")

  function play() {
    setPhase("generating")
    // The real flow navigates to /insights, the placeholder spins while the Gemini call
    // runs, then the card populates in place. ~1.8s mirrors a typical generation.
    window.setTimeout(() => setPhase("done"), 1800)
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <button type="button" className="tk-btn tk-btn-act tk-btn-sm" onClick={play} disabled={phase === "generating"}>
          {phase === "idle" ? "Play the generate flow" : phase === "generating" ? "Generating…" : "Replay"}
        </button>
        {phase !== "idle" ? (
          <button type="button" className="tk-btn tk-btn-ghost tk-btn-sm" onClick={() => setPhase("idle")}>
            Reset
          </button>
        ) : null}
      </div>

      {phase === "idle" ? (
        <p style={{ fontSize: 14, color: "var(--ink-2)", maxWidth: "62ch", lineHeight: 1.6 }}>
          Click play to see what “Generate insight” does on the Insights page: a placeholder spins at the top of the
          pool, then the new insight populates in place with a “Just generated” marker, above the rest of your pool.
        </p>
      ) : (
        <TkToastProvider>
          <div className="ins-feed">
            {/* Pinned top block — the exact markup the real feed renders */}
            {phase === "generating" ? (
              <div className="ins-gen-pending" aria-live="polite">
                <div className="ins-gen-skel tk-sweep" aria-hidden="true" />
                <span className="ins-gen-note">Generating your insight…</span>
              </div>
            ) : (
              <div className="ins-gen-landed">
                <InsightCardKit insight={GENERATED} />
              </div>
            )}

            {/* The rest of the pool, to show the generated card is pinned at the top */}
            <div className="ins-cats">
              <section className="ins-cat">
                <div className="tk-sec-head">
                  <h3>More from your pool</h3>
                  <span className="tk-rule" aria-hidden="true" />
                </div>
                <div className="tk-grid ins-grid">
                  {POOL.map((i) => (
                    <div key={i.id}>
                      <InsightCardKit insight={i} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </TkToastProvider>
      )}
    </div>
  )
}
