"use client"

// Voice / own-network selects + communications toggles, rebuilt to The Pass.
// Same wired behavior as settings-controls.tsx — these call the SAME server actions
// (setVoiceTone, setOwnSocialNetwork, setCommsPref) with the same optimistic-rollback
// and "saved" seams. Only the presentation moves to kit tk-set-* controls.

import { useState, useTransition } from "react"
import { setVoiceTone, setCommsPref, setOwnSocialNetwork, setWeeklyDigestDay } from "./actions"

const VOICES = [
  { v: "warm_personal", label: "Warm, personal" },
  { v: "professional", label: "Professional" },
  { v: "casual", label: "Casual" },
  { v: "playful", label: "Playful" },
  { v: "upscale", label: "Upscale" },
]

export function VoiceSelectPass({ initial, locationId }: { initial: string | null; locationId?: string }) {
  const [v, setV] = useState(initial ?? "warm_personal")
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const [saving, startSaving] = useTransition()

  function onChange(next: string) {
    setV(next)
    setStatus(null)
    if (!locationId) return
    startSaving(async () => {
      const res = await setVoiceTone(locationId, next)
      setErr(!res.ok)
      setStatus(res.ok ? "Saved — used from your next brief." : (res.error ?? "Could not save."))
    })
  }

  return (
    <>
      <select
        className="tk-set-select"
        value={v}
        aria-label="Your voice"
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
        style={{ maxWidth: 280 }}
      >
        {VOICES.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
      </select>
      {status ? <span className={`tk-set-status${err ? " tk-set-status-err" : ""}`}>{status}</span> : null}
    </>
  )
}

const NETWORKS = [
  { v: "instagram", label: "Instagram" },
  { v: "facebook", label: "Facebook" },
  { v: "tiktok", label: "TikTok" },
]

export function OwnNetworkSelectPass({
  initial,
  locationId,
}: {
  initial: string | null
  locationId?: string
}) {
  const [v, setV] = useState(initial ?? "instagram")
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const [saving, startSaving] = useTransition()

  function onChange(next: string) {
    const prev = v
    setV(next)
    setStatus(null)
    if (!locationId) return
    startSaving(async () => {
      const res = await setOwnSocialNetwork(locationId, next)
      if (res.ok) {
        setErr(false)
        setStatus("Saved — we're pulling it now. History on the new network starts fresh.")
      } else {
        setV(prev)
        setErr(true)
        setStatus(res.error ?? "Could not save.")
      }
    })
  }

  return (
    <>
      <select
        className="tk-set-select"
        value={v}
        aria-label="Your social network"
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
        style={{ maxWidth: 280 }}
      >
        {NETWORKS.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
      </select>
      {status ? <span className={`tk-set-status${err ? " tk-set-status-err" : ""}`}>{status}</span> : null}
    </>
  )
}

function Switch({
  title, hint, on, disabled, onChange,
}: { title: string; hint: string; on: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="tk-set-toggle">
      <span className="tk-set-toggle-text"><b>{title}</b><span>{hint}</span></span>
      <span className="tk-set-switch">
        <input type="checkbox" checked={on} disabled={disabled} aria-label={title} onChange={(e) => onChange(e.target.checked)} />
        <span className="tk-set-switch-track" aria-hidden="true" />
      </span>
    </label>
  )
}

const COMMS_DEFAULTS: Record<string, boolean> = {
  weekly_digest: true,
  browser_notifications: true,
  product_updates: true,
}

// D6 digest plumbing: the digest email's footer deep-links here
// (/settings#weekly-digest — the anchor lives on the wrapper in page.tsx).
// Per-USER preference (profiles.weekly_digest_day), unlike the location-scoped
// toggles: two members of one org can want different days. Monday default —
// operators are often closed Mondays, so it lands on their admin day.
const DIGEST_DAYS = [
  { v: 1, label: "Monday" },
  { v: 2, label: "Tuesday" },
  { v: 3, label: "Wednesday" },
  { v: 4, label: "Thursday" },
  { v: 5, label: "Friday" },
  { v: 6, label: "Saturday" },
  { v: 0, label: "Sunday" },
]

export function DigestDaySelectPass({ initial }: { initial?: number | null }) {
  const valid = typeof initial === "number" && initial >= 0 && initial <= 6
  const [day, setDay] = useState<number>(valid ? initial : 1)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const [saving, startSaving] = useTransition()

  function onChange(next: number) {
    const prev = day
    setDay(next)
    setStatus(null)
    startSaving(async () => {
      const res = await setWeeklyDigestDay(next)
      if (res.ok) {
        setErr(false)
        setStatus("Saved — your digest lands that morning.")
      } else {
        setDay(prev)
        setErr(true)
        setStatus(res.error ?? "Could not save.")
      }
    })
  }

  return (
    <label className="tk-set-toggle">
      <span className="tk-set-toggle-text">
        <b>Digest day</b>
        <span>The morning your weekly digest arrives. Yours alone — teammates pick their own.</span>
      </span>
      <span>
        <select
          className="tk-set-select"
          value={day}
          aria-label="Digest day"
          disabled={saving}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ maxWidth: 180 }}
        >
          {DIGEST_DAYS.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
        </select>
        {status ? <span className={`tk-set-status${err ? " tk-set-status-err" : ""}`} style={{ display: "block", marginTop: 6 }}>{status}</span> : null}
      </span>
    </label>
  )
}

export function CommsPrefsPass({
  email,
  locationId,
  initial,
  digestDay,
}: {
  email: string
  locationId?: string
  initial?: Record<string, boolean> | null
  digestDay?: number | null
}) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ ...COMMS_DEFAULTS, ...(initial ?? {}) })
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState(false)
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
        setErr(true)
        setStatus(res.error ?? "Could not save.")
      } else {
        setErr(false)
        setStatus("Saved.")
      }
    })
  }

  return (
    <div className="tk-set-toggles">
      <Switch
        title="Weekly digest email"
        hint={`A highlights email that drives you back to your brief — sent to ${email}.`}
        on={prefs.weekly_digest}
        disabled={saving}
        onChange={(v) => toggle("weekly_digest", v)}
      />
      <DigestDaySelectPass initial={digestDay} />
      <Switch
        title="New-brief notifications"
        hint="An in-app heads-up when a new brief is ready."
        on={prefs.browser_notifications}
        disabled={saving}
        onChange={(v) => toggle("browser_notifications", v)}
      />
      <Switch
        title="Product updates"
        hint="Occasional news about new features. Monthly at most."
        on={prefs.product_updates}
        disabled={saving}
        onChange={(v) => toggle("product_updates", v)}
      />
      {status ? <span className={`tk-set-status${err ? " tk-set-status-err" : ""}`} style={{ marginTop: 10 }}>{status}</span> : null}
    </div>
  )
}
