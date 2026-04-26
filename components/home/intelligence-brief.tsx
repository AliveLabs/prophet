import Link from "next/link"
import { TicketLogo } from "@/components/brand/ticket-logo"

interface BriefProps {
  briefText?: string
  recommendedAction?: string
  signalPills?: Array<{ label: string; color: "gold" | "teal" | "indigo" }>
  updatedAgo?: string
}

const PILL_STYLES = {
  gold: "border-signal-gold/20 bg-signal-gold/10 text-signal-gold",
  teal: "border-precision-teal/20 bg-precision-teal/10 text-precision-teal",
  indigo: "border-primary/20 bg-primary/10 text-vatic-indigo-soft",
}

export default function IntelligenceBrief({
  briefText,
  recommendedAction,
  signalPills = [],
  updatedAgo = "just now",
}: BriefProps) {
  const hasBrief = briefText && briefText.length > 0

  return (
    <section className="brief-card relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.13] via-deep-indigo/[0.06] to-transparent p-5 sm:p-6">
      {/* Top glow line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      {/* Ticket T watermark */}
      <div className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 opacity-[0.06]">
        <TicketLogo size={88} className="text-foreground" simplified />
      </div>

      {/* Eyebrow */}
      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-primary">
          <span className="live-dot" />
          Your Daily Brief
        </div>
        <span className="text-[11.5px] text-muted-foreground">
          Updated {updatedAgo}
        </span>
      </div>

      {/* Body */}
      {hasBrief ? (
        <p
          className="relative mb-4 max-w-[720px] font-display text-[19px] font-medium leading-[1.5] text-foreground max-md:text-[15.5px]"
          dangerouslySetInnerHTML={{ __html: briefText }}
        />
      ) : (
        <p className="relative mb-4 max-w-[720px] font-display text-[19px] font-medium leading-[1.5] text-muted-foreground max-md:text-[15.5px]">
          No intelligence brief available yet. Generate insights to see your daily summary here.
        </p>
      )}

      {/* Recommended action */}
      {recommendedAction && (
        <div className="mb-4 max-w-[720px] rounded-r-md border border-precision-teal/20 border-l-[3px] border-l-precision-teal bg-precision-teal/[0.07] px-4 py-3">
          <div className="mb-[5px] flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.09em] text-precision-teal">
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                d="M5.5 1 L6.8 4.2 L10.2 4.5 L7.8 6.8 L8.5 10.2 L5.5 8.5 L2.5 10.2 L3.2 6.8 L0.8 4.5 L4.2 4.2 Z"
                strokeLinejoin="round"
              />
            </svg>
            Recommended Action
          </div>
          <div
            className="text-[13px] leading-[1.55] text-foreground"
            dangerouslySetInnerHTML={{ __html: recommendedAction }}
          />
        </div>
      )}

      {/* Footer */}
      <div className="relative flex flex-wrap items-center gap-3">
        {signalPills.map((pill, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded-full border px-[10px] py-[3px] text-[11px] font-semibold ${PILL_STYLES[pill.color]}`}
          >
            {pill.label}
          </span>
        ))}
        <Link
          href="/insights"
          className="ml-auto flex items-center gap-1 whitespace-nowrap text-[12.5px] font-medium text-primary transition-colors hover:text-vatic-indigo-soft max-md:hidden"
        >
          Read full brief
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M1.5 5.5 L9.5 5.5M6.5 2.5 L9.5 5.5 L6.5 8.5" />
          </svg>
        </Link>
      </div>
    </section>
  )
}
