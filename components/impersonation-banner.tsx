"use client"

// Persistent full-width banner shown for the whole impersonation session (Phase 6d). Rendered
// by the dashboard layout only when an active impersonation cookie is present. Read-only is
// enforced centrally by proxy.ts (all mutations blocked while impersonating), so the label is
// accurate. Exit navigates to the GET teardown route (signs out + clears + → /login).
export function ImpersonationBanner({
  actorEmail,
  targetEmail,
}: {
  actorEmail: string
  targetEmail: string
}) {
  return (
    <div className="flex items-center justify-center gap-3 bg-signal-gold px-4 py-2 text-center text-sm font-medium text-black">
      <span>
        Viewing as <strong>{targetEmail}</strong> — admin <strong>{actorEmail}</strong> (read-only)
      </span>
      <a
        href="/api/impersonation/exit"
        className="rounded-md bg-black/15 px-3 py-1 text-xs font-semibold text-black hover:bg-black/25"
      >
        Exit
      </a>
    </div>
  )
}
