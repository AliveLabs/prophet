"use client"

// The Pass — the "watched accounts" manager, restyled to the kit.
//
// Keeps the wired server actions (save / delete / verify / discover) and the
// shared <HandleManager/> editor (semantic-token styled → both themes work).
// Only the surrounding chrome is rebuilt: a TkCard with a TkSectionHead-style
// header, a Pass discovery TkButton, and a pointer to the Competitors roster
// (UX gap §7: managing watched entities is homed here + on Competitors).

import { useTransition, useState } from "react"
import HandleManager from "@/components/social/handle-manager"
import { TkButton } from "@/components/ticket"
import {
  saveSocialProfileAction,
  deleteSocialProfileAction,
  verifySocialProfileAction,
  runSocialDiscoveryAction,
} from "./actions"

type SocialHandle = {
  id: string
  entityType: "location" | "competitor"
  entityId: string
  entityName: string
  platform: "instagram" | "facebook" | "tiktok"
  handle: string
  profileUrl: string | null
  discoveryMethod: "auto_scrape" | "data365_search" | "manual"
  isVerified: boolean
}

type Props = {
  locationId: string
  locationName: string
  locationHandles: SocialHandle[]
  competitorHandleGroups: SocialHandle[][]
}

export default function SocialHandleSection({
  locationId,
  locationName,
  locationHandles,
  competitorHandleGroups,
}: Props) {
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
      }
    })
  }

  return (
    <div className="sp-handles tk-card">
      <div className="sp-handles-head">
        <div>
          <h3 className="sp-handles-title">Watched accounts</h3>
          <p className="sp-handles-sub">
            The handles we read for you and the competitors we track. A wrong handle means we read
            the wrong account — fix one here or on{" "}
            <a href="/competitors">Competitors</a>.
          </p>
        </div>
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

      <div className="sp-handle-groups">
        <HandleManager
          entityType="location"
          entityId={locationId}
          entityName={locationName}
          handles={locationHandles}
          onSave={saveSocialProfileAction}
          onDelete={deleteSocialProfileAction}
          onVerify={verifySocialProfileAction}
        />

        {competitorHandleGroups.map((handles) => {
          const first = handles[0]
          if (!first) return null
          return (
            <HandleManager
              key={first.entityId}
              entityType="competitor"
              entityId={first.entityId}
              entityName={first.entityName}
              handles={handles}
              onSave={saveSocialProfileAction}
              onDelete={deleteSocialProfileAction}
              onVerify={verifySocialProfileAction}
            />
          )
        })}
      </div>
    </div>
  )
}
