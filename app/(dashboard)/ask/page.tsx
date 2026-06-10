// Ask — the answer-first anchor as an authed nav destination. The one-off question is
// LIVE (domain-locked, grounded via /api/ask). Batch 2: every ask persists to
// ask_history (rendered below), and a pinned STANDING question re-runs each morning
// after the brief precompute, its answer landing here + on the brief rail.

import { resolveOperator } from "../operator-data"
import { loadRecentAsks, loadStandingAnswer, getStandingQuestion } from "@/lib/ask/history"
import AskBox from "./ask-box"
import StandingForm from "./standing-form"

function fmtAskDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p")
}

export default async function AskPage() {
  const op = await resolveOperator()
  const [recent, standingQuestion, standingAnswer] = await Promise.all([
    loadRecentAsks(op.locationId, 10),
    getStandingQuestion(op.locationId),
    loadStandingAnswer(op.locationId),
  ])

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Ask Ticket</span>
        <h1 className="pv-h1">Ask anything about your market.</h1>
        <p className="pv-sub">Plain-language questions, answered only from your own market and competitor data, never the open web.</p>
      </div>
      <hr className="pv-rule" />

      <div className="pv-section">
        <div className="pv-ask-hero">
          <AskBox />
          <p className="pv-ask-foot">Domain-locked · answers come only from {op.locationName}&apos;s market and competitor data · cost-controlled</p>
        </div>

        <div className="pv-standing">
          {standingQuestion ? (
            <>
              <div className="sl">Standing question · re-runs every morning</div>
              <div className="sq">{standingQuestion}</div>
              {standingAnswer && standingAnswer.question === standingQuestion ? (
                <p className="sa">{standingAnswer.answer}</p>
              ) : (
                <p className="sa">Pinned. The first answer lands here after tomorrow morning&apos;s brief.</p>
              )}
            </>
          ) : (
            <>
              <div className="sl">Standing question · pin one</div>
              <div className="sq">Who&apos;s undercutting me?</div>
              <p className="sa">Pin a question like this and its answer will land here every morning, grounded in the same signals as your brief.</p>
            </>
          )}
          <StandingForm locationId={op.locationId} current={standingQuestion} />
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Recent asks <span className="pv-section-sub">history</span></div>
        {recent.length ? recent.map((r) => (
          <div className="pv-card pv-ev" key={r.id}>
            <div className="pv-ev__type">
              {r.source === "standing" ? "Standing question" : "You asked"} · {fmtAskDate(r.createdAt)}
              {!r.grounded ? " · not in your data yet" : ""}
            </div>
            <div className="pv-ev__title">{r.question}</div>
            <p className="pv-ev__summary">{r.answer}</p>
            {r.sources.length ? (
              <p className="pv-ask-sources">From: {r.sources.join(" · ")}</p>
            ) : null}
          </div>
        )) : (
          <div className="pv-card"><p className="pv-ev__summary">No asks yet — every question and answer is saved here once you start asking.</p></div>
        )}
      </div>
    </div>
  )
}
