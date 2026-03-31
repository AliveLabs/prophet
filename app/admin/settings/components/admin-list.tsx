"use client"

import { useTransition, useState } from "react"
import { removePlatformAdmin } from "@/app/actions/admin-management"

interface PlatformAdmin {
  id: string
  email: string
  user_id: string
  created_at: string | null
}

export function AdminList({ admins }: { admins: PlatformAdmin[] }) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  function handleRemove(id: string) {
    startTransition(async () => {
      const result = await removePlatformAdmin(id)
      setFeedback(result.ok ? result.message : result.error)
      setConfirmId(null)
      setTimeout(() => setFeedback(null), 4000)
    })
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div className="rounded-lg border border-precision-teal/30 bg-precision-teal/10 px-4 py-2 text-sm text-precision-teal">
          {feedback}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Added</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {admins.map((admin) => (
              <tr
                key={admin.id}
                className="transition-colors hover:bg-secondary/40"
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {admin.email}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {admin.created_at
                    ? new Date(admin.created_at).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {confirmId === admin.id ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleRemove(admin.id)}
                        disabled={isPending}
                        className="rounded-md bg-destructive px-2.5 py-1 text-xs font-semibold text-white hover:bg-destructive/90 disabled:opacity-50"
                      >
                        {isPending ? "..." : "Confirm"}
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(admin.id)}
                      className="rounded-md bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive/25"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
