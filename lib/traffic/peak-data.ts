const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export type CompetitorPeak = {
  competitor_name: string
  busiest_day: string
  peak_hour: string
  peak_score: number
  avg_peak: number
  typical_time_spent: string | null
  current_popularity: number | null
}

export function buildPeakData(
  data: Array<{
    competitor_name: string
    days: Array<{
      day_of_week: number
      hourly_scores: number[]
      peak_hour: number
      peak_score: number
      typical_time_spent: string | null
    }>
    current_popularity?: number | null
  }>
): CompetitorPeak[] {
  return data.map((comp) => {
    const busiest = [...comp.days].sort((a, b) => b.peak_score - a.peak_score)[0]
    const avgPeak = comp.days.length > 0
      ? Math.round(comp.days.reduce((sum, d) => sum + d.peak_score, 0) / comp.days.length)
      : 0

    return {
      competitor_name: comp.competitor_name,
      busiest_day: busiest ? DAY_NAMES[busiest.day_of_week] : "N/A",
      peak_hour: busiest ? formatHour(busiest.peak_hour) : "N/A",
      peak_score: busiest?.peak_score ?? 0,
      avg_peak: avgPeak,
      typical_time_spent: busiest?.typical_time_spent ?? null,
      current_popularity: comp.current_popularity ?? null,
    }
  }).sort((a, b) => b.peak_score - a.peak_score)
}
