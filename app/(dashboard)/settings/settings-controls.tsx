"use client"

// Editable Settings controls. Voice SAVES for real when a locationId is provided
// (setVoiceTone, RLS-guarded) — it's what the engine's dual-voice pass writes customer
// copy with. Communications prefs persist too (Batch 4): locations.settings.communications,
// read by the weekly-digest cron and the new-brief notice.

import { useState, useTransition } from "react"
import { setVoiceTone, setCommsPref, setOwnSocialNetwork } from "./actions"

const VOICES = [
  { v: "warm_personal", label: "Warm, personal" },
  { v: "professional", label: "Professional" },
  { v: "casual", label: "Casual" },
  { v: "playful", label: "Playful" },
  { v: "upscale", label: "Upscale" },
]

export function VoiceSelect({ initial, locationId }: { initial: string | null; locationId?: string }) {
  const [v, setV] = useState(initial ?? "warm_personal")
  const [status, setStatus] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  function onChange(next: string) {
    setV(next)
    setStatus(null)
    if (!locationId) return
    startSaving(async () => {
      const res = await setVoiceTone(locationId, next)
      setStatus(res.ok ? "Saved — used from your next brief." : (res.error ?? "Could not save."))
    })
  }

  return (
    <span>
      <select className="pv-input pv-select" value={v} aria-label="Your voice" disabled={saving} onChange={(e) => onChange(e.target.value)}>
        {VOICES.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
      </select>
      {status ? <span className="pv-soon" style={{ marginLeft: 8 }}>{status}</span> : null}
    </span>
  )
}

const NETWORKS = [
  { v: "instagram", label: "Instagram" },
  { v: "facebook", label: "Facebook" },
  { v: "tiktok", label: "TikTok" },
]

// Tier-1 own-network-of-choice: which ONE network we collect for the
// customer's own account. Other detected handles stay listed as the
// "tracked on Tier 2+" upsell seam (rendered server-side on the page).
export function OwnNetworkSelect({
  initial,
  locationId,
}: {
  initial: string | null
  locationId?: string
}) {
  const [v, setV] = useState(initial ?? "instagram")
  const [status, setStatus] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  function onChange(next: string) {
    const prev = v
    setV(next)
    setStatus(null)
    if (!locationId) return
    startSaving(async () => {
      const res = await setOwnSocialNetwork(locationId, next)
      if (res.ok) {
        setStatus("Saved — we're pulling it now. History on the new network starts fresh.")
      } else {
        setV(prev)
        setStatus(res.error ?? "Could not save.")
      }
    })
  }

  return (
    <span>
      <select className="pv-input pv-select" value={v} aria-label="Your social network" disabled={saving} onChange={(e) => onChange(e.target.value)}>
        {NETWORKS.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
      </select>
      {status ? <span className="pv-soon" style={{ marginLeft: 8 }}>{status}</span> : null}
    </span>
  )
}

function Toggle({
  title, hint, on, disabled, onChange,
}: { title: string; hint: string; on: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="pv-toggle">
      <span className="pv-toggle__text"><b>{title}</b><span>{hint}</span></span>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const COMMS_DEFAULTS: Record<string, boolean> = {
  weekly_digest: true,
  browser_notifications: true,
  product_updates: true,
}

export function CommsPrefs({
  email,
  locationId,
  initial,
}: {
  email: string
  locationId?: string
  initial?: Record<string, boolean> | null
}) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ ...COMMS_DEFAULTS, ...(initial ?? {}) })
  const [status, setStatus] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  function toggle(key: string, on: boolean) {
    const prev = prefs[key]
    setPrefs((p) => ({ ...p, [key]: on }))
    setStatus(null)
    if (!locationId) return
    startSaving(async () => {
      const res = await setCommsPref(locationId, key, on)
      if (!res.ok) {
        setPrefs((p) => ({ ...p, [key]: prev }))
        setStatus(res.error ?? "Could not save.")
      } else {
        setStatus("Saved.")
      }
    })
  }

  return (
    <div className="pv-card">
      <Toggle title="Weekly digest email" hint={`A highlights email that drives you back to your brief — sent to ${email}.`} on={prefs.weekly_digest} disabled={saving} onChange={(v) => toggle("weekly_digest", v)} />
      <Toggle title="New-brief notifications" hint="An in-app heads-up when a new brief is ready." on={prefs.browser_notifications} disabled={saving} onChange={(v) => toggle("browser_notifications", v)} />
      <Toggle title="Product updates" hint="Occasional news about new features. Monthly at most." on={prefs.product_updates} disabled={saving} onChange={(v) => toggle("product_updates", v)} />
      {status ? <span className="pv-soon">{status}</span> : null}
    </div>
  )
}
