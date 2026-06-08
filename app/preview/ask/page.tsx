// First-pass Ask page — the answer-first anchor as its own destination. Bounded NL
// query over your market + competitor data only (domain-locked). A pinned "standing
// question" that re-runs each morning is a COMING capability (framed as an example, not
// an active config). The live answer engine isn't wired yet, so the input, answer, and
// history are shown as honest previews.

import { loadPreviewContext } from "../preview-data"

const SUGGESTED = [
  "Who's undercutting me right now?",
  "What changed this week?",
  "What should I prep before the weekend?",
  "Which competitor is gaining on social?",
  "Where am I losing ground?",
]

export default async function PreviewAsk() {
  const ctx = await loadPreviewContext()
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Ask Ticket</span>
        <h1 className="pv-h1">Ask anything about your market.</h1>
        <p className="pv-sub">Plain-language questions, answered only from your own market and competitor data, never the open web. Soon you&apos;ll be able to pin a standing question that re-runs every morning, so the answer is waiting for you.</p>
      </div>
      <hr className="pv-rule" />

      <div className="pv-section">
        <div className="pv-ask-hero">
          <div className="pv-ask-input">
            <input type="text" placeholder="Ask about your market…" aria-label="Ask Ticket (coming soon)" disabled />
          </div>
          <div className="pv-chips">
            {SUGGESTED.map((q) => (<span className="pv-chip" key={q}>{q}</span>))}
          </div>
          <p className="pv-ask-foot">Domain-locked · answers come only from {ctx.locationName}&apos;s market and competitor data · cost-controlled</p>
        </div>

        <div className="pv-standing">
          <div className="sl">Standing question · example · coming soon</div>
          <div className="sq">Who&apos;s undercutting me?</div>
          <p className="sa">Pin a question like this and its answer will land here every morning, grounded in the same signals as your brief.</p>
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Recent asks <span className="pv-section-sub">history</span></div>
        <div className="pv-card" style={{ textAlign: "center" }}>
          <span className="pv-soon">The live answer engine + history aren&apos;t wired yet — this page roughs the experience and placement.</span>
        </div>
      </div>
    </div>
  )
}
