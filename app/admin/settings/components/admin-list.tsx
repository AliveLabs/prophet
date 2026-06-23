"use client"

import { useTransition, useState } from "react"
import { removePlatformAdmin, setPlatformAdminRole } from "@/app/actions/admin-management"
import { ADMIN_ROLES, normalizeRole, type AdminRole } from "@/lib/auth/capabilities"

interface PlatformAdmin {
  id: string
  email: string
  user_id: string
  created_at: string | null
  role?: string | null
}

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  read_only: "Read-only",
}

export function AdminList({
  admins,
  canManage = false,
}: {
  admins: PlatformAdmin[]
  canManage?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  function flash(ok: boolean, text: string) {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const result = await removePlatformAdmin(id)
      flash(result.ok, result.ok ? result.message : result.error)
      setConfirmId(null)
    })
  }

  function handleRoleChange(id: string, role: AdminRole) {
    startTransition(async () => {
      const result = await setPlatformAdminRole(id, role)
      flash(result.ok, result.ok ? result.message : result.error)
    })
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            feedback.ok
              ? "border-precision-teal/30 bg-precision-teal/10 text-precision-teal"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Added</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {admins.map((admin) => {
              const role = normalizeRole(admin.role)
              return (
                <tr
                  key={admin.id}
                  className="transition-colors hover:bg-secondary/40"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {admin.email}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={role}
                        disabled={isPending}
                        aria-label={`Role for ${admin.email}`}
                        onChange={(e) =>
                          handleRoleChange(admin.id, e.target.value as AdminRole)
                        }
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      >
                        {ADMIN_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {ROLE_LABEL[role]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {admin.created_at
                      ? new Date(admin.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                  {canManage && (
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
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
