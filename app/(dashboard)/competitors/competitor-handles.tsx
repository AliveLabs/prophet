// Per-competitor watched-accounts manager, surfaced ON the competitor detail page —
// where the absence is felt (the "their accounts are quiet or unverified" empty state).
// Rebuilt to The Pass: a kit TkCard wrapping the new <CompetitorHandleRoster/> (add /
// change / remove + per-handle provenance + a discovery trigger). Server component shell;
// the roster is the client island. Same wired social actions — presentation only.

import { TkCard, TkSectionHead } from "@/components/ticket"
import CompetitorHandleRoster from "./competitor-handle-roster"
import {
  saveSocialProfileAction,
  deleteSocialProfileAction,
  verifySocialProfileAction,
  runCompetitorSocialDiscoveryAction,
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
    <section className="tk-comp-sec">
      <TkSectionHead
        title="Watched accounts"
        sub="The social profiles we read for this competitor"
      />
      <TkCard>
        <CompetitorHandleRoster
          entityType="competitor"
          entityId={competitorId}
          entityName={competitorName}
          handles={handles}
          onSave={saveSocialProfileAction}
          onDelete={deleteSocialProfileAction}
          onVerify={verifySocialProfileAction}
          // ALT-190: discovery scoped to THIS competitor (not the whole set).
          onDiscover={runCompetitorSocialDiscoveryAction}
        />
        <p className="tk-note">
          A wrong or missing handle means we read the wrong account — fix it here and the next pull
          picks it up. <span style={{ fontWeight: 600 }}>Verified</span> accounts are confirmed;
          <span style={{ fontWeight: 600 }}> Discovering</span> ones are our best match until you confirm them.
        </p>
      </TkCard>
    </section>
  )
}
