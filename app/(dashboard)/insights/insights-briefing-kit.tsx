// The Pass — the AI Priority Briefing, REBUILT to the kit.
//
// REPLACES the shared <PriorityBriefing/> presentation (we may not edit it). The
// #1 priority becomes a TkHero (the lead of the page); the rest become a TkPlayCard
// grid. The data is the SAME PriorityItem[] the server action produces — we only
// change the presentation. Server-safe (no hooks); the expand/collapse on long
// items is handled with a native <details>, so no client island is needed.

import type { CSSProperties } from "react"
import type { PriorityItem } from "@/lib/ai/prompts/priority-briefing"
import { SOURCE_LABELS, type SourceCategory } from "@/lib/insights/scoring"
import {
  RevealOnView,
  TkSectionHead,
  TkHero,
  TkPlayCard,
  TkChip,
  type TkFamily,
} from "@/components/ticket"
import { FAMILY_ICON } from "../home/pass-icons"
import { accentize } from "@/components/ticket/accentize"

const CAT_FAMILY: Record<SourceCategory, TkFamily> = {
  competitors: "reputation",
  events: "competitive",
  seo: "competitive",
  social: "social",
  content: "menu",
  photos: "menu",
  traffic: "competitive",
}

const URGENCY_LABEL: Record<PriorityItem["urgency"], string> = {
  critical: "Act in 24–48h",
  warning: "This week",
  info: "Plan ahead",
}

function ActionLine({ action }: { action: string }) {
  return (
    <div className="ins-brief-action">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      <span>{action}</span>
    </div>
  )
}

export default function InsightsBriefingKit({
  priorities,
  locationName,
}: {
  priorities: PriorityItem[]
  locationName: string
}) {
  if (priorities.length === 0) return null
  const [lead, ...rest] = priorities
  const leadFamily = CAT_FAMILY[lead.source]

  return (
    <div className="ins-brief">
      <TkSectionHead
        title="Priority briefing"
        sub={`The plays that matter most for ${locationName} right now`}
      />

      <RevealOnView className="ins-brief-hero-wrap">
        <TkHero
          title={accentize(lead.title)}
          chips={
            <>
              <TkChip family={leadFamily}>{SOURCE_LABELS[lead.source]}</TkChip>
              <span className={`ins-urg ins-urg-${lead.urgency}`}>{URGENCY_LABEL[lead.urgency]}</span>
            </>
          }
          lede={lead.why}
          photoLabel={locationName}
        >
          <ActionLine action={lead.action} />
        </TkHero>
      </RevealOnView>

      {rest.length ? (
        <RevealOnView className="tk-grid ins-brief-grid" stagger>
          {rest.map((item, i) => {
            const family = CAT_FAMILY[item.source]
            return (
              <div key={i} style={{ "--tk-i": i } as CSSProperties}>
                <TkPlayCard
                  family={family}
                  icon={FAMILY_ICON[family]}
                  title={item.title}
                  chips={
                    <>
                      <TkChip family={family}>{SOURCE_LABELS[item.source]}</TkChip>
                      <span className={`ins-urg ins-urg-${item.urgency}`}>
                        {URGENCY_LABEL[item.urgency]}
                      </span>
                    </>
                  }
                  summary={item.why}
                >
                  <ActionLine action={item.action} />
                </TkPlayCard>
              </div>
            )
          })}
        </RevealOnView>
      ) : null}
    </div>
  )
}
