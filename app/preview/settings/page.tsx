// Settings page — account, brief tuning, voice, and communications. Controls are
// editable working shells (Phase 6); saving wires up with the authed page. Competitor
// management now lives on the Competitors page, so here we link to it rather than
// duplicate the manager.

import Link from "next/link"
import { connection } from "next/server"
import { loadPreviewContext, tierLabel } from "../preview-data"
import BriefTuning from "../../(dashboard)/settings/brief-tuning"
import { VoiceSelect, CommsPrefs } from "../../(dashboard)/settings/settings-controls"
import { TkRule } from "@/components/ticket"

export default async function PreviewSettings() {
  await connection()
  const ctx = await loadPreviewContext()
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Settings</h1>
        <p className="pv-sub">Your account, how your briefs are tuned, and the competitors we watch for you.</p>
      </div>
      <TkRule />

      <div className="pv-section">
        <div className="pv-section-head">Account</div>
        <div className="pv-card">
          <div className="pv-field"><div className="pv-field__label">Restaurant</div><div className="pv-field__val">{ctx.locationName}{ctx.city ? <div className="pv-field__hint">{ctx.city}</div> : null}</div></div>
          <div className="pv-field"><div className="pv-field__label">Plan</div><div className="pv-field__val">{tierLabel(ctx.tier)}</div></div>
          <div className="pv-field"><div className="pv-field__label">Operator</div><div className="pv-field__val">Anand</div></div>
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Your briefs <span className="pv-section-sub">how broad your recommendations are</span></div>
        <div className="pv-card">
          <div className="pv-field">
            <div className="pv-field__label">Idea boldness</div>
            <div className="pv-field__val">
              <BriefTuning initial={ctx.brandTolerance} />
              <div className="pv-field__hint">Sets how broad or narrow your recommendation thresholds are. Started from your onboarding answers; your 👍 / 👎 on the brief refine it over time.</div>
            </div>
          </div>
          <div className="pv-field">
            <div className="pv-field__label">Your voice</div>
            <div className="pv-field__val">
              <VoiceSelect initial={ctx.voiceTone} />
              <div className="pv-field__hint">Used when we draft customer-facing copy in your name.</div>
            </div>
          </div>
          <div className="pv-field">
            <div className="pv-field__label">Cadence</div>
            <div className="pv-field__val">Weekly deep brief<div className="pv-field__hint">Daily briefings available on higher plans.</div></div>
          </div>
          <span className="pv-soon">Tuning is a working preview — saving + recompute land with the authed Settings page.</span>
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Communications <span className="pv-section-sub">how we reach you</span></div>
        <CommsPrefs email="anand@alivemethod.com" />
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Watched competitors <span className="pv-section-sub">{ctx.competitors.length} of your plan&apos;s limit</span></div>
        <div className="pv-card pv-pointer">
          <div className="pv-pointer__text">Add, remove, and review the competitors we watch on the Competitors page.</div>
          <Link className="pv-link" href="/preview/competitors">Manage competitors</Link>
        </div>
      </div>
    </div>
  )
}
