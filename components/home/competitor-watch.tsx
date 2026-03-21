interface CompetitorSignal {
  name: string
  changePercent: number
  changeDir: "up" | "down"
  barPercent: number
  barColor: string
  signalCount: number
  summary: string
}

interface TrendingPill {
  label: string
  color: "gold" | "teal" | "indigo"
}

const PILL_STYLES = {
  gold: "bg-signal-gold/10 text-signal-gold",
  teal: "bg-precision-teal/10 text-precision-teal",
  indigo: "bg-primary/10 text-vatic-indigo-soft",
}

const BAR_COLORS: Record<string, string> = {
  indigo: "bg-vatic-indigo-soft",
  gold: "bg-signal-gold",
  teal: "bg-precision-teal",
  red: "bg-destructive/70",
  muted: "bg-muted-violet",
}

interface CompetitorWatchProps {
  competitors: CompetitorSignal[]
  trending?: TrendingPill[]
}

export default function CompetitorWatch({
  competitors,
  trending = [],
}: CompetitorWatchProps) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
          <svg
            className="h-[13px] w-[13px] text-primary"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <polyline points="1,11 3.5,7 6.5,8.5 9.5,4 12,2" />
            <path d="M9.5 2 L12 2 L12 4.5" />
          </svg>
          Competitor Watch
        </div>
      </div>

      {/* Signals */}
      <div className="flex-1 overflow-y-auto">
        {competitors.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground">
            No competitor activity this week
          </div>
        ) : (
          competitors.map((c, i) => (
            <div
              key={i}
              className="border-b border-border px-5 py-3 transition-colors hover:bg-secondary/20 last:border-b-0"
            >
              <div className="mb-[5px] flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-foreground">
                  {c.name}
                </span>
                <span
                  className={`text-[11.5px] font-bold ${
                    c.changeDir === "up"
                      ? "text-precision-teal"
                      : "text-destructive"
                  }`}
                >
                  {c.changeDir === "up" ? "↑" : "↓"} {Math.abs(c.changePercent)}%
                </span>
              </div>
              <div className="mb-[5px] h-1 overflow-hidden rounded-full bg-secondary/60">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${BAR_COLORS[c.barColor] ?? BAR_COLORS.muted}`}
                  style={{ width: `${c.barPercent}%` }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {c.signalCount} signal{c.signalCount !== 1 ? "s" : ""} &middot;{" "}
                {c.summary}
              </div>
            </div>
          ))
        )}

        {/* Trending */}
        {trending.length > 0 && (
          <div className="border-t border-border px-5 py-4">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              In Your Neighborhood This Week
            </div>
            <div className="flex flex-wrap gap-1">
              {trending.map((pill, i) => (
                <span
                  key={i}
                  className={`rounded-full px-[10px] py-[3px] text-[11px] font-medium ${PILL_STYLES[pill.color]}`}
                >
                  {pill.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
