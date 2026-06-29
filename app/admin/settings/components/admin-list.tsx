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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {feedback && (
        <div className={`adm-flash ${feedback.ok ? "is-ok" : "is-err"}`} role="status">
          {feedback.text}
        </div>
      )}

      <div className="adm-table-wrap">
        <div style={{ overflowX: "auto" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Added</th>
                {canManage && <th style={{ textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => {
                const role = normalizeRole(admin.role)
                return (
                  <tr key={admin.id}>
                    <td className="is-email">{admin.email}</td>
                    <td>
                      {canManage ? (
                        <select
                          value={role}
                          disabled={isPending}
                          aria-label={`Role for ${admin.email}`}
                          onChange={(e) =>
                            handleRoleChange(admin.id, e.target.value as AdminRole)
                          }
                          className="adm-select"
                        >
                          {ADMIN_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="adm-rolepill">{ROLE_LABEL[role]}</span>
                      )}
                    </td>
                    <td className="tk-mono" style={{ fontSize: 12 }}>
                      {admin.created_at
                        ? new Date(admin.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                    {canManage && (
                      <td style={{ textAlign: "right" }}>
                        {confirmId === admin.id ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 10,
                            }}
                          >
                            <button
                              onClick={() => handleRemove(admin.id)}
                              disabled={isPending}
                              className="adm-confirm-btn"
                            >
                              {isPending ? "…" : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              className="adm-cancel-btn"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmId(admin.id)}
                            className="adm-remove-btn"
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
    </div>
  )
}
