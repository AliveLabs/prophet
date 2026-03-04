"use client"

import { useState, useTransition } from "react"

type SocialHandle = {
  id: string
  platform: "instagram" | "facebook" | "tiktok"
  handle: string
  profileUrl: string | null
  discoveryMethod: "auto_scrape" | "data365_search" | "manual"
  isVerified: boolean
}

type Props = {
  entityType: "location" | "competitor"
  entityId: string
  entityName: string
  handles: SocialHandle[]
  onSave: (data: {
    entityType: "location" | "competitor"
    entityId: string
    platform: string
    handle: string
  }) => Promise<{ error?: string }>
  onDelete: (id: string) => Promise<{ error?: string }>
  onVerify: (id: string) => Promise<{ error?: string }>
}

const PLATFORM_META: Record<string, { icon: string; label: string; placeholder: string; prefix: string }> = {
  instagram: { icon: "📸", label: "Instagram", placeholder: "username", prefix: "instagram.com/" },
  facebook: { icon: "📘", label: "Facebook", placeholder: "pagename", prefix: "facebook.com/" },
  tiktok: { icon: "🎵", label: "TikTok", placeholder: "username", prefix: "tiktok.com/@" },
}

export default function HandleManager({
  entityType,
  entityId,
  entityName,
  handles,
  onSave,
  onDelete,
  onVerify,
}: Props) {
  const [adding, setAdding] = useState<string | null>(null)
  const [newHandle, setNewHandle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const existingPlatforms = new Set(handles.map((h) => h.platform))
  const missingPlatforms = ["instagram", "facebook", "tiktok"].filter(
    (p) => !existingPlatforms.has(p as SocialHandle["platform"])
  )

  function handleAdd(platform: string) {
    setAdding(platform)
    setNewHandle("")
    setError(null)
  }

  function handleSave() {
    if (!adding || !newHandle.trim()) return
    setError(null)

    startTransition(async () => {
      const result = await onSave({
        entityType,
        entityId,
        platform: adding,
        handle: newHandle.trim().replace(/^@/, ""),
      })
      if (result.error) {
        setError(result.error)
      } else {
        setAdding(null)
        setNewHandle("")
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await onDelete(id)
    })
  }

  function handleVerify(id: string) {
    startTransition(async () => {
      await onVerify(id)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">
          Social Profiles — {entityName}
        </h4>
      </div>

      {/* Existing handles */}
      {handles.length > 0 && (
        <div className="space-y-2">
          {handles.map((h) => {
            const meta = PLATFORM_META[h.platform]
            return (
              <div
                key={h.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <span className="text-lg">{meta?.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-700">
                      @{h.handle}
                    </span>
                    {h.isVerified && (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600">
                        Verified
                      </span>
                    )}
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                      {h.discoveryMethod === "auto_scrape"
                        ? "Auto-discovered"
                        : h.discoveryMethod === "data365_search"
                          ? "Search match"
                          : "Manual"}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {meta?.prefix}{h.handle}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {!h.isVerified && (
                    <button
                      type="button"
                      onClick={() => handleVerify(h.id)}
                      disabled={isPending}
                      className="rounded-md border border-emerald-200 px-2 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      Verify
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(h.id)}
                    disabled={isPending}
                    className="rounded-md border border-rose-200 px-2 py-1 text-[10px] font-medium text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add new handle */}
      {adding ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{PLATFORM_META[adding]?.icon}</span>
            <div className="flex flex-1 items-center rounded-md border border-slate-200 bg-white px-2">
              <span className="text-xs text-slate-400">@</span>
              <input
                type="text"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                placeholder={PLATFORM_META[adding]?.placeholder}
                className="flex-1 border-0 bg-transparent px-1 py-1.5 text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave()
                  if (e.key === "Escape") setAdding(null)
                }}
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !newHandle.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setAdding(null)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="mt-1 text-[11px] text-rose-500">{error}</p>
          )}
        </div>
      ) : (
        missingPlatforms.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {missingPlatforms.map((platform) => (
              <button
                key={platform}
                type="button"
                onClick={() => handleAdd(platform)}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
              >
                <span>{PLATFORM_META[platform]?.icon}</span>
                Add {PLATFORM_META[platform]?.label}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}
