"use client"

// The Pass — the per-entity watched-accounts editor (operator's own location or a
// competitor). Presentation rebuilt to the kit: inline SVG network glyphs (the same
// filled set the recent-posts grid uses), TkButton actions, per-handle PROVENANCE
// badges (verified / discovering / needs-check — UX gaps §7), token-driven so light +
// warm-dark both work for free. Styling lives in the Social page's social.css under
// the sp-hm- namespace and mirrors the Competitors roster's visual language.
//
// The data shape (SocialHandle) and the wired server actions (onSave / onDelete /
// onVerify) are UNCHANGED — this is a presentation-only rebuild.

import { useState, useTransition, type ReactNode } from "react"
import { TkButton } from "@/components/ticket"

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

const PLATFORM_ORDER = ["instagram", "facebook", "tiktok"] as const

// Inline SVG network glyphs — the same filled set used by the recent-posts grid
// (app/(dashboard)/social/social-posts-pass.tsx) so the page reads as one product.
const NET_ICON: Record<string, ReactNode> = {
  instagram: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.64.07 4.85 0 3.2-.01 3.58-.07 4.85-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07-3.2 0-3.58-.01-4.85-.07-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12c0-3.2.01-3.58.07-4.85.15-3.23 1.66-4.77 4.92-4.92C8.42 2.17 8.8 2.16 12 2.16Zm0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.07C24 5.44 18.63.07 12 .07S0 5.44 0 12.07c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08v-3.47h3.05V9.43c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.02 24 18.06 24 12.07Z" />
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 1 1-2.1-2.79v-3.5a6.34 6.34 0 1 0 5.55 6.29V8.7a8.26 8.26 0 0 0 5.58 2.17V7.4a4.83 4.83 0 0 1-1.81-.71Z" />
    </svg>
  ),
}

const PLATFORM_META: Record<
  string,
  { label: string; placeholder: string; prefix: string; cls: string }
> = {
  instagram: { label: "Instagram", placeholder: "username", prefix: "instagram.com/", cls: "sp-hm-ig" },
  facebook: { label: "Facebook", placeholder: "pagename", prefix: "facebook.com/", cls: "sp-hm-fb" },
  tiktok: { label: "TikTok", placeholder: "username", prefix: "tiktok.com/@", cls: "sp-hm-tt" },
}

const CHECK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2l-1.5-1.5z" />
  </svg>
)
const RM_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)
const ADD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** Provenance derived honestly from what the row tells us (UX gaps §7):
 *  - verified    → confirmed the right account (we're reading it)
 *  - discovering → found by auto/search, not yet confirmed (reading provisionally)
 *  - needs check → added manually, not yet verified */
function ProvenanceBadge({ handle }: { handle: SocialHandle }) {
  if (handle.isVerified) {
    return (
      <span className="sp-hm-prov sp-hm-prov-verified" title="Confirmed — we're reading this account">
        {CHECK_ICON}
        Verified
      </span>
    )
  }
  const auto = handle.discoveryMethod === "auto_scrape" || handle.discoveryMethod === "data365_search"
  return (
    <span
      className="sp-hm-prov sp-hm-prov-discovering"
      title={
        auto
          ? "Found by discovery — confirm it's the right account"
          : "Added manually — verify to lock it in"
      }
    >
      <span className="sp-hm-prov-dot" aria-hidden="true" />
      {auto ? "Discovering" : "Needs check"}
    </span>
  )
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
  const missingPlatforms = PLATFORM_ORDER.filter(
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
    <div className="sp-hm">
      <div className="sp-hm-head">
        <h4 className="sp-hm-title">{entityName}</h4>
        <span className={`sp-hm-tag ${entityType === "location" ? "sp-hm-tag-you" : "sp-hm-tag-comp"}`}>
          {entityType === "location" ? "You" : "Competitor"}
        </span>
      </div>

      {/* Existing handles */}
      {handles.length > 0 && (
        <div className="sp-hm-rows">
          {handles.map((h) => {
            const meta = PLATFORM_META[h.platform]
            return (
              <div key={h.id} className="sp-hm-row">
                <span className={`sp-hm-plat ${meta?.cls ?? ""}`} aria-hidden="true">
                  {NET_ICON[h.platform]}
                </span>
                <div className="sp-hm-body">
                  <div className="sp-hm-handle">
                    <span className="sp-hm-at">@{h.handle}</span>
                    <ProvenanceBadge handle={h} />
                  </div>
                  <div className="sp-hm-url">
                    {meta?.prefix}
                    {h.handle}
                  </div>
                </div>
                <div className="sp-hm-acts">
                  {!h.isVerified && (
                    <TkButton
                      variant="keep"
                      onClick={() => handleVerify(h.id)}
                      disabled={isPending}
                    >
                      Verify
                    </TkButton>
                  )}
                  <TkButton
                    variant="dismiss"
                    className="sp-hm-rm"
                    onClick={() => handleDelete(h.id)}
                    disabled={isPending}
                    aria-label={`Remove @${h.handle}`}
                  >
                    {RM_ICON}
                  </TkButton>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add a handle */}
      {adding ? (
        <div className="sp-hm-add-panel">
          <div className="sp-hm-add-field">
            <span className={`sp-hm-plat ${PLATFORM_META[adding]?.cls ?? ""}`} aria-hidden="true">
              {NET_ICON[adding]}
            </span>
            <span className="sp-hm-input-wrap">
              <span className="sp-hm-at" aria-hidden="true">@</span>
              <input
                type="text"
                className="sp-hm-input"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                placeholder={PLATFORM_META[adding]?.placeholder}
                aria-label={`${PLATFORM_META[adding]?.label} handle for ${entityName}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave()
                  if (e.key === "Escape") setAdding(null)
                }}
                autoFocus
              />
            </span>
            <TkButton
              variant="act"
              onClick={handleSave}
              disabled={isPending || !newHandle.trim()}
            >
              Save
            </TkButton>
            <TkButton variant="ghost" onClick={() => setAdding(null)} disabled={isPending}>
              Cancel
            </TkButton>
          </div>
          {error && <p className="sp-hm-err">{error}</p>}
        </div>
      ) : (
        missingPlatforms.length > 0 && (
          <div className="sp-hm-add-chips">
            {missingPlatforms.map((platform) => (
              <TkButton
                key={platform}
                variant="add"
                onClick={() => handleAdd(platform)}
              >
                {ADD_ICON}
                Add {PLATFORM_META[platform]?.label}
              </TkButton>
            ))}
          </div>
        )
      )}
    </div>
  )
}
