interface MetricData {
  label: string
  value: string | number
  valueName?: string
  delta?: string
  deltaType?: "up" | "down" | "warn" | "flat"
  colorClass?: string
  icon: React.ReactNode
}

function DeltaIcon({ type }: { type: string }) {
  if (type === "up") {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M4.5 7.5 L4.5 1.5M1.5 4.5 L4.5 1.5 L7.5 4.5" />
      </svg>
    )
  }
  if (type === "down") {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M4.5 1.5 L4.5 7.5M1.5 4.5 L4.5 7.5 L7.5 4.5" />
      </svg>
    )
  }
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="4.5" cy="4.5" r="3.5" />
      <path d="M4.5 2.5 L4.5 4.8M4.5 6.2 L4.5 6.4" strokeLinecap="round" />
    </svg>
  )
}

const DELTA_COLORS: Record<string, string> = {
  up: "text-precision-teal",
  down: "text-destructive",
  warn: "text-signal-gold",
  flat: "text-muted-foreground",
}

interface MetricCardsProps {
  metrics: MetricData[]
}

export default function MetricCards({ metrics }: MetricCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {metrics.map((m, i) => (
        <article
          key={i}
          className="flex cursor-default flex-col gap-2 rounded-lg border border-border bg-card px-5 py-4 transition-all duration-200 hover:-translate-y-px hover:border-border/80 hover:bg-secondary/30"
        >
          <div className="flex items-center gap-2 text-[11.5px] font-medium tracking-[0.02em] text-muted-foreground">
            <span className="h-3 w-3 shrink-0 opacity-70">{m.icon}</span>
            {m.label}
          </div>

          {m.valueName ? (
            <div className={`text-[15px] font-bold leading-tight ${m.colorClass ?? "text-foreground"}`}>
              {m.valueName}
            </div>
          ) : (
            <div className={`font-display text-[34px] font-semibold leading-none tracking-tight ${m.colorClass ?? "text-foreground"}`}>
              {m.value}
            </div>
          )}

          {m.delta && (
            <div className={`flex items-center gap-[3px] text-[11.5px] font-medium ${DELTA_COLORS[m.deltaType ?? "flat"]}`}>
              <DeltaIcon type={m.deltaType ?? "flat"} />
              {m.delta}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
