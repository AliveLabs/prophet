// Settings — account, brief tuning, voice, data refresh, and communications (Stage A
// port). Brief boldness + voice SAVE for real; data refresh is wired to the durable
// queue; billing/organization/team keep their existing sub-pages.

import Link from "next/link"
import { loadOperatorContext, tierLabel } from "../operator-data"
import { requireUser } from "@/lib/auth/server"
import BriefTuning from "./brief-tuning"
import { VoiceSelect, CommsPrefs } from "./settings-controls"
import RefreshControls from "./refresh-controls"

import { createServerSupabaseClient } from "@/lib/supabase/server"

export default async function SettingsPage() {
  const user = await requireUser()
  const ctx = await loadOperatorContext()
  const email = user.email ?? "you"
  const sb = await createServerSupabaseClient()
  const { data: locRow } = await sb
    .from("locations")
    .select("settings")
    .eq("id", ctx.locationId)
    .maybeSingle()
  const comms = ((locRow?.settings as Record<string, unknown> | null)?.communications ?? null) as Record<string, boolean> | null
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Settings</h1>
        <p className="pv-sub">Your account, how your briefs are tuned, and the data behind them.</p>
      </div>
      <hr className="pv-rule" />

      <div className="pv-section">
        <div className="pv-section-head">Account</div>
        <div className="pv-card">
          <div className="pv-field"><div className="pv-field__label">Restaurant</div><div className="pv-field__val">{ctx.locationName}{ctx.city ? <div className="pv-field__hint">{ctx.city}</div> : null}</div></div>
          <div className="pv-field"><div className="pv-field__label">Plan</div><div className="pv-field__val">{tierLabel(ctx.tier)} <Link className="pv-link" href="/settings/billing" style={{ marginLeft: 8 }}>Billing →</Link></div></div>
          <div className="pv-field"><div className="pv-field__label">Operator</div><div className="pv-field__val">{ctx.userName}<div className="pv-field__hint">{email}</div></div></div>
          <div className="pv-field"><div className="pv-field__label">Workspace</div><div className="pv-field__val"><Link className="pv-link" href="/settings/organization">Organization →</Link> <Link className="pv-link" href="/settings/team" style={{ marginLeft: 12 }}>Team →</Link></div></div>
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Your briefs <span className="pv-section-sub">how broad your recommendations are</span></div>
        <div className="pv-card">
          <div className="pv-field">
            <div className="pv-field__label">Idea boldness</div>
            <div className="pv-field__val">
              <BriefTuning initial={ctx.brandTolerance} locationId={ctx.locationId} />
              <div className="pv-field__hint">Sets how broad or narrow your recommendation thresholds are. Your 👍 / 👎 on the brief refine it over time.</div>
            </div>
          </div>
          <div className="pv-field">
            <div className="pv-field__label">Your voice</div>
            <div className="pv-field__val">
              <VoiceSelect initial={ctx.voiceTone} locationId={ctx.locationId} />
              <div className="pv-field__hint">Used when we draft customer-facing copy in your name.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Your data <span className="pv-section-sub">refresh on demand</span></div>
        <RefreshControls locationId={ctx.locationId} />
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Competitors</div>
        <div className="pv-card">
          <div className="pv-field">
            <div className="pv-field__label">Watched set</div>
            <div className="pv-field__val">
              Watching {ctx.competitors.length} — manage them on the <Link className="pv-link" href="/competitors">Competitors page</Link>.
            </div>
          </div>
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Communications</div>
        <CommsPrefs email={email} locationId={ctx.locationId} initial={comms} />
      </div>
    </div>
  )
}
