// Ask page — the answer-first anchor as its own destination. The one-off question is
// LIVE now (Phase 9): bounded, domain-locked NL query over the location's own market +
// competitor data via /api/preview/ask (AskBox). A *pinned* standing question that
// re-runs each morning is still a coming capability (shown as an example). Saved
// history isn't wired yet.

import { connection } from "next/server"
import { loadPreviewContext } from "../preview-data"
import AskBox from "../../(dashboard)/ask/ask-box"
import { TkRule } from "@/components/ticket"

export default async function PreviewAsk() {
  await connection()
  const ctx = await loadPreviewContext()
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Ask Ticket</span>
        <h1 className="pv-h1">Ask anything about your market.</h1>
        <p className="pv-sub">Plain-language questions, answered only from your own market and competitor data, never the open web.</p>
      </div>
      <TkRule />

      <div className="pv-section">
        <div className="pv-ask-hero">
          <AskBox endpoint="/api/preview/ask" />
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
          <span className="pv-soon">Answers run live now — saved history across sessions is coming.</span>
        </div>
      </div>
    </div>
  )
}
