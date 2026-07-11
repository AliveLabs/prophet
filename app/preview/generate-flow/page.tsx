// DEV/REVIEW-ONLY harness for the ALT-230 "Generate insight" result UX (placeholder ->
// pinned "Just generated" card at the top of the pool). Uses the real components + CSS;
// data is mocked. Prod-guarded by the preview layout (VERCEL_ENV !== production).

import { GenerateFlowDemo } from "./generate-flow-demo"
import "@/components/ticket/pass.css"
import "../../(dashboard)/insights/insights.css"
import { TkRule } from "@/components/ticket"

export default function GenerateFlowPreview() {
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">ALT-230 · Generate flow</span>
        <h1 className="pv-h1">Generate insight, live</h1>
        <p className="pv-sub">
          What the viz-card “Generate insight” action produces on the Insights page. The live version runs a Gemini
          call behind your login; this plays the same on-page states with the real cards and styling.
        </p>
      </div>
      <TkRule />

      <div className="ticket-brief tk-kit" style={{ marginTop: 24 }}>
        <GenerateFlowDemo />
      </div>
    </div>
  )
}
