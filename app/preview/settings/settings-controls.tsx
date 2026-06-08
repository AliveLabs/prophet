"use client"

// Editable Settings controls (Phase 6): voice picker + merged Communications
// preferences (digest + product updates + browser alerts in one place, replacing the
// old read-only "Notifications" + separate marketing toggle). Working shells — saving
// wires up with the authed page.

import { useState } from "react"

const VOICES = [
  { v: "warm_personal", label: "Warm, personal" },
  { v: "professional", label: "Professional" },
  { v: "casual", label: "Casual" },
  { v: "playful", label: "Playful" },
  { v: "upscale", label: "Upscale" },
]

export function VoiceSelect({ initial }: { initial: string | null }) {
  const [v, setV] = useState(initial ?? "warm_personal")
  return (
    <select className="pv-input pv-select" value={v} aria-label="Your voice" onChange={(e) => setV(e.target.value)}>
      {VOICES.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
    </select>
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
      <span className="pv-soon">Communication preferences save with the authed page.</span>
    </div>
  )
}
