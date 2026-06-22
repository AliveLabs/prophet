"use client"

import { useState, useTransition } from "react"
import { clearTestData, type ClearTestTarget } from "@/app/actions/admin-maintenance"

export function ClearTestData() {
  const [includeDemo, setIncludeDemo] = useState(false)
  const [preview, setPreview] = useState<{ count: number; targets: ClearTestTarget[] } | null>(null)
  const [typed, setTyped] = useState("")
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  function runPreview() {
    setFeedback(null)
    setTyped("")
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
    if (!preview || typed !== String(preview.count)) return
    startTransition(async () => {
      const result = await clearTestData({ includeDemo, dryRun: false })
      if (!result.ok) {
        setFeedback({ ok: false, message: result.error })
        return
      }
      setFeedback({ ok: true, message: `Cleared ${result.count} org(s).` })
      setPreview(null)
      setTyped("")
    })
  }

  const confirmReady = preview !== null && preview.count > 0 && typed === String(preview.count)

  return (
    <div className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6">
      <p className="text-sm text-muted-foreground">
        Permanently deletes all <strong className="text-foreground">test</strong>
        {includeDemo ? " and demo" : ""} orgs and every bit of their data. Customer
        orgs and any org with a live subscription are never touched. Always preview
        first.
      </p>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            feedback.ok
              ? "border-precision-teal/30 bg-precision-teal/10 text-precision-teal"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={includeDemo}
          onChange={(e) => {
            setIncludeDemo(e.target.checked)
            setPreview(null)
            setTyped("")
          }}
          className="h-4 w-4 rounded border-input"
        />
        Include demo orgs (default: test only)
      </label>

      <button
        type="button"
        onClick={runPreview}
        disabled={isPending}
        className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50"
      >
        {isPending && !preview ? "Previewing…" : "Preview"}
      </button>

      {preview && (
        <div className="space-y-4 border-t border-border pt-5">
          {preview.count === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing matches — nothing to clear.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                Will delete {preview.count} org(s):
              </p>
              <ul className="max-h-60 space-y-1 overflow-y-auto text-sm text-muted-foreground">
                {preview.targets.map((t) => (
                  <li key={t.id}>
                    — {t.name}{" "}
                    <span className="uppercase opacity-70">({t.orgKind})</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm font-semibold text-destructive">
                This cannot be undone. Type{" "}
                <span className="font-mono">{preview.count}</span> to confirm.
              </p>
              <div className="flex gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={String(preview.count)}
                  className="w-28 rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={runClear}
                  disabled={!confirmReady || isPending}
                  className="rounded-lg bg-destructive px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {isPending ? "Clearing…" : `Clear ${preview.count} org(s)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
