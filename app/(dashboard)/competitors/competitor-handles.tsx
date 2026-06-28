"use client"

// Per-competitor social-handle management, surfaced ON the competitor detail page — where
// the absence is felt (the "their accounts are quiet or unverified" empty states). Pure
// reuse: the shared <HandleManager /> + the existing social actions. No new data surface.
import HandleManager from "@/components/social/handle-manager"
import {
  saveSocialProfileAction,
  deleteSocialProfileAction,
  verifySocialProfileAction,
} from "../social/actions"
import type { ManagedHandle } from "../proof-data"

export default function CompetitorHandles({
  competitorId,
  competitorName,
  handles,
}: {
  competitorId: string
  competitorName: string
  handles: ManagedHandle[]
}) {
  return (
    <div className="pv-section">
      <div className="pv-section-head">
        Social handles
        <span className="pv-section-sub">which accounts we watch for this competitor</span>
      </div>
      <div className="pv-card">
        <HandleManager
          entityType="competitor"
          entityId={competitorId}
          entityName={competitorName}
          handles={handles}
          onSave={saveSocialProfileAction}
          onDelete={deleteSocialProfileAction}
          onVerify={verifySocialProfileAction}
        />
        <p className="pv-handles-note">
          A wrong or missing handle means we read the wrong account — fix it here and the next
          pull picks it up. Auto-discovery for every account runs from <a href="/social">Social</a>.
        </p>
      </div>
    </div>
  )
}
