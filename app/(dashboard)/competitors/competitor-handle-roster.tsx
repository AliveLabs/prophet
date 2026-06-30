"use client"

// The watched-entities surface, rebuilt to The Pass (contract §7 — the BIG UX gap).
//
// Manage which social accounts we read for ONE entity (a competitor here; the same
// component drives the operator's own handles): add / change / remove a handle, fire
// auto-discovery, and read each handle's PROVENANCE (verified / discovering / not-found)
// at a glance. This REPLACES the shared <HandleManager/> presentation — the data wiring
// is identical (the same save / delete / verify / discover server actions).

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { TkButton } from "@/components/ticket"
import type { ManagedHandle } from "../proof-data"

type Platform = "instagram" | "facebook" | "tiktok"

type SaveFn = (data: {
  entityType: "location" | "competitor"
  entityId: string
  platform: string
  handle: string
}) => Promise<{ error?: string }>

const PLATFORMS: Platform[] = ["instagram", "facebook", "tiktok"]

const PLATFORM_META: Record<
  Platform,
  { label: string; prefix: string; placeholder: string; cls: string; icon: ReactNode }
> = {
  instagram: {
    label: "Instagram",
    prefix: "instagram.com/",
    placeholder: "username",
    cls: "tk-hr-ig",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  facebook: {
    label: "Facebook",
    prefix: "facebook.com/",
    placeholder: "pagename",
    cls: "tk-hr-fb",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M14 9V7c0-1 .5-1.5 1.6-1.5H17V2.2C16.6 2.1 15.5 2 14.3 2 11.6 2 10 3.7 10 6.6V9H7.5v3.4H10V22h3.5v-9.6H16l.5-3.4z" />
      </svg>
    ),
  },
  tiktok: {
    label: "TikTok",
    prefix: "tiktok.com/@",
    placeholder: "username",
    cls: "tk-hr-tt",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16 3c.3 2.1 1.6 3.8 3.7 4.2v2.7c-1.4 0-2.7-.4-3.7-1.1v5.9c0 3.2-2.6 5.4-5.5 5.4S5 19.8 5 16.9c0-2.9 2.4-5.2 5.6-4.9v2.8c-.4-.1-.8-.2-1.1-.2-1.3 0-2.4 1-2.4 2.3 0 1.4 1 2.4 2.4 2.4 1.4 0 2.5-1 2.5-2.6V3z" />
      </svg>
    ),
  },
}

const VERIFIED_ICON = (
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
const DISCOVER_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
)

/** Provenance is derived honestly from what the row tells us:
 *  - verified  → we've confirmed this is the right account (reading it)
 *  - discovering → found by auto/search, not yet verified (reading provisionally)
 *  - manual but unverified → "needs check" (treated as discovering-class amber) */
function ProvenanceBadge({ h }: { h: ManagedHandle }) {
  if (h.isVerified) {
    return (
      <span className="tk-prov tk-prov-verified" title="Confirmed — we're reading this account">
        {VERIFIED_ICON} Verified
      </span>
    )
  }
  const auto = h.discoveryMethod === "auto_scrape" || h.discoveryMethod === "data365_search"
  return (
    <span
      className="tk-prov tk-prov-discovering"
      title={auto ? "Found by discovery — confirm it's the right account" : "Added manually — verify to lock it in"}
    >
      <span className="tk-prov-dot" aria-hidden="true" />
      {auto ? "Discovering" : "Needs check"}
    </span>
  )
}

export default function CompetitorHandleRoster({
  entityType,
  entityId,
  entityName,
  handles,
  onSave,
  onDelete,
  onVerify,
  onDiscover,
}: {
  entityType: "location" | "competitor"
  entityId: string
  entityName: string
  handles: ManagedHandle[]
  onSave: SaveFn
  onDelete: (id: string) => Promise<{ error?: string }>
  onVerify: (id: string) => Promise<{ error?: string }>
  /** ALT-190: discovery scoped to THIS entity (the competitor we're on), searched by
   *  its id — not a whole-set sweep. Omitted ⇒ the discover affordance is hidden. */
  onDiscover?: (entityId: string) => Promise<{ discovered: number; error?: string }>
}) {
  const router = useRouter()
  const [adding, setAdding] = useState<Platform | null>(null)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [discovering, startDiscovery] = useTransition()
  const [discoverMsg, setDiscoverMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null)

  const present = new Set(handles.map((h) => h.platform))
  const missing = PLATFORMS.filter((p) => !present.has(p))

  function save() {
    if (!adding || !value.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await onSave({
        entityType,
        entityId,
        platform: adding,
        handle: value.trim().replace(/^@/, ""),
      })
      if (res.error) {
        setError(res.error)
      } else {
        setAdding(null)
        setValue("")
        router.refresh()
      }
    })
  }
  function remove(id: string) {
    startTransition(async () => {
      await onDelete(id)
      router.refresh()
    })
  }
  function verify(id: string) {
    startTransition(async () => {
      await onVerify(id)
      router.refresh()
    })
  }
  function discover() {
    if (!onDiscover) return
    setDiscoverMsg(null)
    startDiscovery(async () => {
      // ALT-190: search ONLY this competitor (entityId), not the whole set.
      const res = await onDiscover(entityId)
      if (res.error) {
        setDiscoverMsg({ tone: "err", text: res.error })
      } else {
        setDiscoverMsg({
          tone: "ok",
          text:
            res.discovered > 0
              ? `Found ${res.discovered} account${res.discovered === 1 ? "" : "s"} for ${entityName} — new ones show as “Discovering” until you verify them.`
              : `Searched for ${entityName}'s accounts — nothing new surfaced this pass.`,
        })
        router.refresh()
      }
    })
  }

  return (
    <div>
      {handles.length ? (
        <div className="tk-hr-rows">
          {handles.map((h) => {
            const meta = PLATFORM_META[h.platform]
            return (
              <div className="tk-hr-row" key={h.id}>
                <span className={`tk-hr-plat ${meta.cls}`} aria-hidden="true">
                  {meta.icon}
                </span>
                <div className="tk-hr-body">
                  <div className="tk-hr-handle">
                    <span className="tk-hr-at">@{h.handle}</span>
                    <ProvenanceBadge h={h} />
                  </div>
                  <div className="tk-hr-url">
                    {meta.prefix}
                    {h.handle}
                  </div>
                </div>
                <div className="tk-hr-acts">
                  {!h.isVerified ? (
                    <button
                      type="button"
                      className="tk-hr-btn tk-hr-verify"
                      onClick={() => verify(h.id)}
                      disabled={pending}
                    >
                      Verify
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="tk-hr-btn tk-hr-rm2"
                    onClick={() => remove(h.id)}
                    disabled={pending}
                    aria-label={`Remove @${h.handle}`}
                  >
                    {RM_ICON}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="tk-rost-quiet" style={{ margin: 0 }}>
          No accounts on file for {entityName} yet. Add one below — or run discovery and we&apos;ll try to
          find them.
        </p>
      )}

      {/* add a handle (per missing platform) */}
      {adding ? (
        <div className="tk-hr-add-panel">
          <div className="tk-hr-add-field">
            <span className={`tk-hr-plat ${PLATFORM_META[adding].cls}`} aria-hidden="true">
              {PLATFORM_META[adding].icon}
            </span>
            <span className="tk-hr-input-wrap">
              <span className="tk-at" aria-hidden="true">@</span>
              <input
                className="tk-hr-input"
                value={value}
                autoFocus
                placeholder={PLATFORM_META[adding].placeholder}
                aria-label={`${PLATFORM_META[adding].label} handle for ${entityName}`}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save()
                  if (e.key === "Escape") setAdding(null)
                }}
                disabled={pending}
              />
            </span>
            <TkButton variant="act" onClick={save} disabled={pending || !value.trim()}>
              Save
            </TkButton>
            <TkButton variant="ghost" onClick={() => setAdding(null)} disabled={pending}>
              Cancel
            </TkButton>
          </div>
          {error ? <p className="tk-form-err">{error}</p> : null}
        </div>
      ) : missing.length ? (
        <div className="tk-hr-add-chips">
          {missing.map((p) => (
            <button
              key={p}
              type="button"
              className="tk-hr-add-chip"
              onClick={() => {
                setAdding(p)
                setValue("")
                setError(null)
              }}
            >
              {ADD_ICON} Add {PLATFORM_META[p].label}
            </button>
          ))}
        </div>
      ) : null}

      {/* discovery trigger + result */}
      {onDiscover ? (
        <div className="tk-discover-bar">
          <span className={`tk-discover-msg${discoverMsg ? ` tk-${discoverMsg.tone}` : ""}`}>
            {discoverMsg
              ? discoverMsg.text
              : "Not sure of the handle? Let us search for the right account."}
          </span>
          <TkButton variant="add" onClick={discover} disabled={discovering}>
            {DISCOVER_ICON} {discovering ? "Searching…" : "Find their accounts"}
          </TkButton>
        </div>
      ) : null}
    </div>
  )
}
