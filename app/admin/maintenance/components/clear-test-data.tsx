"use client"

import { useState, useTransition } from "react"
import { clearTestData, type ClearTestTarget } from "@/app/actions/admin-maintenance"
import { RevealOnView, TkButton } from "@/components/ticket"

export function ClearTestData() {
  const [includeDemo, setIncludeDemo] = useState(false)
  const [preview, setPreview] = useState<{ count: number; targets: ClearTestTarget[] } | null>(null)
  const [typed, setTyped] = useState("")
  const [reason, setReason] = useState("")
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  function runPreview() {
    setFeedback(null)
    setTyped("")
    setReason("")
    startTransition(async () => {
      const result = await clearTestData({ includeDemo, dryRun: true })
      if (!result.ok) {
        setFeedback({ ok: false, message: result.error })
        setPreview(null)
        return
      }
      if (!result.dryRun) return // we requested dryRun:true; narrows the union
      setPreview({ count: result.count, targets: result.targets })
    })
  }

  function runClear() {
    if (!preview || typed !== String(preview.count) || !reason.trim()) return
    startTransition(async () => {
      const result = await clearTestData({
        includeDemo,
        dryRun: false,
        reason,
        confirmedOrgIds: preview.targets.map((t) => t.id),
      })
      if (!result.ok) {
        setFeedback({ ok: false, message: result.error })
        return
      }
      setFeedback({ ok: true, message: `Cleared ${result.count} org(s).` })
      setPreview(null)
      setTyped("")
      setReason("")
    })
  }

  const confirmReady =
    preview !== null &&
    preview.count > 0 &&
    typed === String(preview.count) &&
    reason.trim().length > 0

  return (
    <RevealOnView className="mt-card">
      <div className="mt-card-body">
        <p className="mt-intro">
          Permanently deletes all <b>test</b>
          {includeDemo ? " and demo" : ""} orgs and every bit of their data. Always preview first.
          <br />
          <span className="mt-safe">
            {shieldIcon}
            Customer orgs and any org with a live subscription are never touched.
          </span>
        </p>

        {feedback && (
          <div className={`mt-banner ${feedback.ok ? "mt-ok" : "mt-err"}`} role="status">
            {feedback.ok ? checkIcon : errIcon}
            {feedback.message}
          </div>
        )}

        <label className="mt-toggle">
          <input
            type="checkbox"
            checked={includeDemo}
            onChange={(e) => {
              setIncludeDemo(e.target.checked)
              setPreview(null)
              setTyped("")
            }}
          />
          <span className="mt-box" aria-hidden>
            {tickIcon}
          </span>
          <span className="mt-tl">
            <span className="mt-tt">Include demo orgs</span>
            <span className="mt-ts">Default clears test orgs only.</span>
          </span>
        </label>

        <div>
          <TkButton
            variant="add"
            onClick={runPreview}
            disabled={isPending}
          >
            {isPending && !preview ? "Previewing…" : "Preview what will be cleared"}
          </TkButton>
        </div>

        {preview && (
          <div className="mt-confirm">
            {preview.count === 0 ? (
              <p className="mt-confirm-empty">Nothing matches — nothing to clear.</p>
            ) : (
              <>
                <h4>
                  Will delete {preview.count} org{preview.count === 1 ? "" : "s"}
                </h4>
                <ul className="mt-targets">
                  {preview.targets.map((t) => (
                    <li key={t.id} className="mt-target">
                      <span className="mt-tn">{t.name}</span>
                      <span className="mt-tk">{t.orgKind}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-danger">
                  <p className="mt-warn">
                    {warnIcon}
                    <span>
                      This cannot be undone. Type{" "}
                      <span className="mt-num">{preview.count}</span> and give a reason to confirm.
                    </span>
                  </p>

                  <div className="mt-field">
                    <label htmlFor="mt-reason">Reason (recorded in the audit log)</label>
                    <input
                      id="mt-reason"
                      type="text"
                      className="mt-input"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why are you clearing these?"
                    />
                  </div>

                  <div className="mt-confirm-row">
                    <div className="mt-field">
                      <label htmlFor="mt-count">Confirm count</label>
                      <input
                        id="mt-count"
                        type="text"
                        inputMode="numeric"
                        className="mt-input mt-num-input"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={String(preview.count)}
                        aria-label={`Type ${preview.count} to confirm`}
                      />
                    </div>
                    <TkButton
                      className="mt-btn-danger"
                      onClick={runClear}
                      disabled={!confirmReady || isPending}
                    >
                      {isPending ? "Clearing…" : `Clear ${preview.count} org${preview.count === 1 ? "" : "s"}`}
                    </TkButton>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </RevealOnView>
  )
}

const shieldIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
)
const tickIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13l4 4L19 7" />
  </svg>
)
const checkIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
)
const errIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.5" />
  </svg>
)
const warnIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l9 16H3l9-16z" />
    <path d="M12 9v4M12 16.5v.5" />
  </svg>
)
