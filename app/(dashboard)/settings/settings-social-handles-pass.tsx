"use client"

// ALT-234 — the CANONICAL home for managing OUR OWN social handles.
//
// The decision (2026-06-29): own-handle add/remove lives ONLY here in Settings;
// competitor handles live ONLY on each competitor's detail page. The old combined
// "Watched accounts" box on the Social page is display-only now and routes here.
//
// Reuses the shared <HandleManager/> editor (entityType="location") + the SAME wired
// server actions, plus a location-level "Discover handles" trigger. The sp-hm-/sp-disc-
// styles come from social.css, imported by the Settings page (the editor's new home).

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import HandleManager from "@/components/social/handle-manager"
import { TkButton } from "@/components/ticket"
import {
  saveSocialProfileAction,
  deleteSocialProfileAction,
  verifySocialProfileAction,
  runSocialDiscoveryAction,
} from "../social/actions"

type OwnHandle = {
  id: string
  platform: "instagram" | "facebook" | "tiktok"
  handle: string
  profileUrl: string | null
  discoveryMethod: "auto_scrape" | "data365_search" | "manual"
  isVerified: boolean
}

export default function SettingsSocialHandles({
  locationId,
  locationName,
  handles,
}: {
  locationId: string
  locationName: string
  handles: OwnHandle[]
}) {
  const router = useRouter()
  const [isDiscovering, startDiscovery] = useTransition()
  const [discoveryResult, setDiscoveryResult] = useState<{ ok: boolean; msg: string } | null>(null)

  function handleDiscover() {
    setDiscoveryResult(null)
    startDiscovery(async () => {
      const result = await runSocialDiscoveryAction(locationId)
      if (result.error) {
        setDiscoveryResult({ ok: false, msg: result.error })
      } else {
        setDiscoveryResult({
          ok: true,
          msg: `Found ${result.discovered} profile${result.discovered !== 1 ? "s" : ""}.`,
        })
        if (result.discovered > 0) router.refresh()
      }
    })
  }

  return (
    <div className="sp-handles">
      <div className="sp-handles-head">
        <p className="sp-handles-sub">
          The handles we read for your account. A wrong handle means we read the wrong account —
          add, fix, or remove them here.
        </p>
        <TkButton variant="add" onClick={handleDiscover} disabled={isDiscovering}>
          {isDiscovering ? (
            <>
              <svg className="sp-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              Discovering…
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              Discover handles
            </>
          )}
        </TkButton>
      </div>

      {discoveryResult && (
        <div className={`sp-disc-note${discoveryResult.ok ? " sp-disc-ok" : " sp-disc-err"}`} role="status">
          {discoveryResult.msg}
        </div>
      )}

      <HandleManager
        entityType="location"
        entityId={locationId}
        entityName={locationName}
        handles={handles}
        onSave={saveSocialProfileAction}
        onDelete={deleteSocialProfileAction}
        onVerify={verifySocialProfileAction}
      />
    </div>
  )
}
