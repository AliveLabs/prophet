// Ask — the answer-first anchor as an authed nav destination (Stage A port). The
// one-off question is LIVE (domain-locked, grounded in the operator's own data via
// /api/ask). The pinned standing question remains a coming capability.

import { resolveOperator } from "../operator-data"
import AskBox from "./ask-box"

export default async function AskPage() {
  const op = await resolveOperator()
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
          <div className="sl">Standing question · example · coming soon</div>
          <div className="sq">Who&apos;s undercutting me?</div>
          <p className="sa">Pin a question like this and its answer will land here every morning, grounded in the same signals as your brief.</p>
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Recent asks <span className="pv-section-sub">history</span></div>
        <div className="pv-card" style={{ textAlign: "center" }}>
          <span className="pv-soon">Answers run live now — saved history across sessions is coming.</span>
        </div>
      </div>
    </div>
  )
}
