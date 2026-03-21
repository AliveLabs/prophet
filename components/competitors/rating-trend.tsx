type RatingDataPoint = {
  dateKey: string
  rating: number
}

type RatingTrendProps = {
  dataPoints: RatingDataPoint[]
  currentRating: number | null
}

export default function RatingTrend({
  dataPoints,
  currentRating,
}: RatingTrendProps) {
  if (currentRating === null && dataPoints.length === 0) return null

  const rating = currentRating ?? dataPoints[dataPoints.length - 1]?.rating ?? null
  if (rating === null) return null

  const hasSparkline = dataPoints.length >= 2
  const earliest = dataPoints[0]
  const delta = earliest ? +(rating - earliest.rating).toFixed(1) : 0
  const deltaDir = delta > 0 ? "up" : delta < 0 ? "down" : "flat"

  const earliestLabel = earliest
    ? new Date(earliest.dateKey + "T00:00:00").toLocaleDateString("en-US", { month: "short" })
    : ""

  // SVG sparkline calculations
  let svgPoints = ""
  let svgPolygon = ""
  let xLabels: string[] = []
  let endX = 300
  let endY = 40

  if (hasSparkline) {
    const ratings = dataPoints.map((d) => d.rating)
    const minR = Math.min(...ratings) - 0.1
    const maxR = Math.max(...ratings) + 0.1
    const rangeR = maxR - minR || 0.1

    const points = dataPoints.map((d, i) => {
      const x = (i / (dataPoints.length - 1)) * 298 + 1
      const y = 5 + ((maxR - d.rating) / rangeR) * 70
      return { x, y }
    })

    svgPoints = points.map((p) => `${p.x},${p.y}`).join(" ")
    svgPolygon = `${svgPoints} ${points[points.length - 1].x},80 ${points[0].x},80`
    endX = points[points.length - 1].x
    endY = points[points.length - 1].y

    const step = Math.max(1, Math.floor(dataPoints.length / 4))
    xLabels = []
    for (let i = 0; i < dataPoints.length; i += step) {
      xLabels.push(
        new Date(dataPoints[i].dateKey + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
        })
      )
    }
    xLabels.push("Now")
  }

  return (
    <section className="mb-6">
      <h2 className="mb-4 font-display text-[22px] font-semibold text-foreground">
        Rating trend
      </h2>

      <div className="overflow-hidden rounded-[18px] border border-border bg-card px-5 py-4">
        {/* Sparkline */}
        {hasSparkline && (
          <>
            <div className="relative mb-1">
              <svg
                className="block h-20 w-full overflow-visible"
                viewBox="0 0 300 80"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Rating trend from ${earliest?.rating} to ${rating}`}
              >
                <defs>
                  <linearGradient id="rtFillGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--vatic-indigo)" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="var(--vatic-indigo)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Grid lines */}
                <line x1="0" y1="20" x2="300" y2="20" stroke="var(--border)" strokeWidth="0.5" />
                <line x1="0" y1="40" x2="300" y2="40" stroke="var(--border)" strokeWidth="0.5" />
                <line x1="0" y1="60" x2="300" y2="60" stroke="var(--border)" strokeWidth="0.5" />
                {/* Area fill */}
                <polygon points={svgPolygon} fill="url(#rtFillGrad)" />
                {/* Line */}
                <polyline
                  points={svgPoints}
                  fill="none"
                  stroke="var(--vatic-indigo)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* End dot */}
                <circle cx={endX} cy={endY} r="3.5" fill="var(--vatic-indigo)" />
                <circle cx={endX} cy={endY} r="6.5" fill="var(--vatic-indigo)" fillOpacity="0.18" />
              </svg>
            </div>

            {/* X-axis labels */}
            <div className="mb-4 mt-1 flex justify-between px-0.5 text-[11px] text-deep-violet">
              {xLabels.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
          </>
        )}

        {/* Stat row */}
        <div className="flex items-baseline gap-3 border-t border-border pt-3">
          <span className="font-display text-[32px] font-semibold leading-none text-foreground">
            {rating}
          </span>
          <span className="flex-1 text-[13px] text-deep-violet">current rating</span>
          {delta !== 0 && (
            <span
              className={`text-xs font-semibold ${
                deltaDir === "up"
                  ? "text-precision-teal"
                  : deltaDir === "down"
                    ? "text-destructive"
                    : "text-muted-foreground"
              }`}
            >
              {deltaDir === "up" ? "↑" : "↓"} {Math.abs(delta)} since {earliestLabel}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
