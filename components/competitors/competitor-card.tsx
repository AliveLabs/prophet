import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  approveCompetitorAction,
  ignoreCompetitorAction,
} from "@/app/(dashboard)/competitors/actions"
import {
  SIGNAL_TYPE_CONFIG,
  type CompetitorSignalAggregate,
  type SignalCategory,
} from "@/lib/competitors/helpers"

const SEVERITY_STRIPE: Record<string, string> = {
  critical: "bg-destructive",
  warning: "bg-signal-gold",
  info: "bg-muted-violet/40",
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-destructive/12 text-destructive",
  warning: "bg-signal-gold/14 text-signal-gold",
  info: "bg-secondary text-muted-foreground",
}

type CompetitorCardProps = {
  competitor: {
    id: string
    name: string | null
    category: string | null
    metadata: unknown
  }
  signals: CompetitorSignalAggregate
  isCandidate?: boolean
}

export default function CompetitorCard({
  competitor,
  signals,
  isCandidate = false,
}: CompetitorCardProps) {
  const meta = competitor.metadata as Record<string, unknown> | null
  const rating = meta?.rating as number | undefined
  const reviewCount = meta?.reviewCount as number | undefined
  const distanceMeters = meta?.distanceMeters as number | undefined

  const distLabel = typeof distanceMeters === "number"
    ? distanceMeters < 1600
      ? `${(distanceMeters / 1609.34).toFixed(1)} mi`
      : `${(distanceMeters / 1609.34).toFixed(1)} mi`
    : null

  const { severity, signalCount, topSignal } = signals
  const stripeClass = SEVERITY_STRIPE[severity] ?? SEVERITY_STRIPE.info
  const badgeClass = SEVERITY_BADGE[severity] ?? SEVERITY_BADGE.info

  const signalConfig = topSignal
    ? SIGNAL_TYPE_CONFIG[topSignal.category as SignalCategory]
    : null

  const cardContent = (
    <>
      {/* Severity stripe */}
      <div
        className={`w-1 shrink-0 ${stripeClass}`}
        aria-hidden="true"
      />

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        {/* Row 1: name + signal badge */}
        <div className="flex items-start justify-between gap-3">
          <span className="font-display text-xl font-semibold leading-tight text-foreground">
            {competitor.name ?? "Unknown"}
          </span>
          {signalCount > 0 && (
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}
            >
              <span
                className="h-[5px] w-[5px] rounded-full bg-current"
                aria-hidden="true"
              />
              {signalCount} this wk
            </span>
          )}
          {isCandidate && signalCount === 0 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Candidate
            </span>
          )}
        </div>

        {/* Row 2: category · distance · rating */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {competitor.category && (
            <span>{competitor.category}</span>
          )}
          {competitor.category && distLabel && (
            <span className="h-0.5 w-0.5 rounded-full bg-deep-violet" aria-hidden="true" />
          )}
          {distLabel && <span>{distLabel}</span>}
          {(competitor.category || distLabel) && typeof rating === "number" && (
            <span className="h-0.5 w-0.5 rounded-full bg-deep-violet" aria-hidden="true" />
          )}
          {typeof rating === "number" && (
            <span className="flex items-center gap-1">
              <svg
                className="h-3 w-3 text-signal-gold"
                viewBox="0 0 12 12"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 1l1.35 2.73 3.01.44-2.18 2.12.51 3-2.69-1.42L3.31 9.29l.51-3L1.64 4.17l3.01-.44L6 1Z" />
              </svg>
              <span>{rating}</span>
              {typeof reviewCount === "number" && (
                <span className="text-deep-violet">
                  ({reviewCount.toLocaleString()})
                </span>
              )}
            </span>
          )}
        </div>

        {/* Row 3: top signal */}
        {topSignal && signalConfig && (
          <div className="flex items-start gap-2">
            <span
              className={`mt-0.5 shrink-0 rounded px-[7px] py-[2px] text-[10px] font-semibold uppercase tracking-wider ${signalConfig.bgClass}`}
            >
              {signalConfig.label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-snug text-foreground">
                {topSignal.headline}
              </p>
              <p className="mt-0.5 text-[11px] text-deep-violet">
                {topSignal.date}
              </p>
            </div>
          </div>
        )}

        {/* Candidate actions */}
        {isCandidate && (
          <div className="flex gap-2 pt-1">
            <form action={approveCompetitorAction}>
              <input type="hidden" name="competitor_id" value={competitor.id} />
              <Button type="submit" variant="secondary" size="sm">
                Approve
              </Button>
            </form>
            <form action={ignoreCompetitorAction}>
              <input type="hidden" name="competitor_id" value={competitor.id} />
              <Button type="submit" variant="ghost" size="sm">
                Ignore
              </Button>
            </form>
          </div>
        )}
      </div>

      {/* Arrow (tracked only) */}
      {!isCandidate && (
        <div className="flex shrink-0 items-center px-3 text-deep-violet transition-colors group-hover:text-muted-foreground">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h6M7 4l3 3-3 3" />
          </svg>
        </div>
      )}
    </>
  )

  if (isCandidate) {
    return (
      <div className="group flex overflow-hidden rounded-[14px] border border-dashed border-primary/22 bg-card transition-colors hover:border-primary/40 hover:bg-secondary/30">
        {cardContent}
      </div>
    )
  }

  return (
    <Link
      href={`/competitors/${competitor.id}`}
      className="group flex overflow-hidden rounded-[14px] border border-border bg-card transition-all hover:border-muted-foreground/20 hover:bg-secondary/30 active:scale-[0.985]"
    >
      {cardContent}
    </Link>
  )
}
