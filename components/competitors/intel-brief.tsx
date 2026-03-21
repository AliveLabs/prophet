import { generateCompetitorBrief } from "@/lib/competitors/brief"

type IntelBriefProps = {
  competitorName: string
  insights: Array<{
    title: string
    summary: string
    severity: string
    insight_type: string
    date_key: string | null
  }>
}

export async function IntelBrief({ competitorName, insights }: IntelBriefProps) {
  const brief = await generateCompetitorBrief(competitorName, insights)

  if (!brief) return null

  return (
    <section className="relative mb-8 overflow-hidden rounded-[18px] border border-primary/28 bg-gradient-to-br from-primary/11 via-vatic-indigo-soft/5 to-transparent px-5 pb-4 pt-5">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute -right-[50px] -top-[50px] h-40 w-40 rounded-full bg-primary/22 blur-3xl"
        aria-hidden="true"
      />

      {/* Eyebrow */}
      <div className="mb-3 flex items-center gap-[7px] text-[11px] font-semibold uppercase tracking-[0.09em] text-vatic-indigo-soft">
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M5.5 0l.88 3.77L10.5 5.5l-4.12 1.73L5.5 11l-.88-3.77L.5 5.5l4.12-1.73L5.5 0Z" />
        </svg>
        This week&rsquo;s intelligence
      </div>

      {/* Narrative */}
      <p
        className="mb-4 text-sm leading-[1.7] text-foreground"
        dangerouslySetInnerHTML={{
          __html: brief.narrative
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
        }}
      />

      {/* Suggested action */}
      <div className="rounded-[14px] border border-border/50 bg-card/40 px-4 py-3">
        <div className="mb-2 flex items-center gap-[5px] text-[11px] font-semibold uppercase tracking-[0.07em] text-signal-gold">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6 1l1.1 3.2H10.3L7.65 6.1l1.1 3.2L6 7.5 3.25 9.3l1.1-3.2L1.7 4.2H4.9L6 1Z" />
          </svg>
          Suggested action
        </div>
        <p
          className="text-[13px] leading-relaxed text-muted-foreground"
          dangerouslySetInnerHTML={{
            __html: brief.suggestedAction
              .replace(/\*\*(.*?)\*\*/g, "<strong class='text-foreground font-medium'>$1</strong>"),
          }}
        />
      </div>
    </section>
  )
}

export function IntelBriefSkeleton() {
  return (
    <section className="mb-8 overflow-hidden rounded-[18px] border border-primary/28 bg-gradient-to-br from-primary/11 via-vatic-indigo-soft/5 to-transparent px-5 pb-4 pt-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-3 w-3 animate-pulse rounded-full bg-primary/30" />
        <div className="h-3 w-40 animate-pulse rounded bg-primary/20" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-secondary/60" />
        <div className="h-4 w-[90%] animate-pulse rounded bg-secondary/60" />
        <div className="h-4 w-[70%] animate-pulse rounded bg-secondary/60" />
      </div>
      <div className="mt-4 rounded-[14px] border border-border/50 bg-card/40 px-4 py-3">
        <div className="mb-2 h-3 w-28 animate-pulse rounded bg-signal-gold/20" />
        <div className="h-4 w-full animate-pulse rounded bg-secondary/40" />
        <div className="mt-1 h-4 w-[80%] animate-pulse rounded bg-secondary/40" />
      </div>
    </section>
  )
}
