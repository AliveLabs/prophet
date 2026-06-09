"use client"

// Editable Settings controls. Voice SAVES for real when a locationId is provided
// (setVoiceTone, RLS-guarded) — it's what the engine's dual-voice pass writes customer
// copy with. Communications prefs remain an honest visual shell (a notification store +
// real digest sending land in the post-cutover backlog).

import { useState, useTransition } from "react"
import { setVoiceTone } from "./actions"

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

function Toggle({ title, hint, defaultOn = false }: { title: string; hint: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn)
  return (
    <label className="pv-toggle">
      <span className="pv-toggle__text"><b>{title}</b><span>{hint}</span></span>
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
    </label>
  )
}

export function CommsPrefs({ email }: { email: string }) {
  return (
    <div className="pv-card">
      <Toggle title="Weekly digest email" hint={`A highlights email that drives you back to your brief — sent to ${email}.`} defaultOn />
      <Toggle title="Browser notifications" hint="A heads-up the moment a new brief is ready." />
      <Toggle title="Product updates" hint="Occasional news about new features. Monthly at most." />
      <span className="pv-soon">These don&apos;t save yet — the digest email + alerts are being built next.</span>
    </div>
  )
}
