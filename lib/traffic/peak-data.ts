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
  /** ALT-722: how many day-rows `avg_peak` was actually averaged over. Carried because a mean over
   *  3 days and a mean over 7 are not comparable, and the UI ranks competitors on this number. */
  days_observed: number
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
    // ALT-722: the denominator is however many day-rows this competitor happens to have, so a
    // place with 3 rows was averaged over 3 and compared against one averaged over 7. A closed or
    // simply missing day therefore RAISED a competitor's average and its rank.
    //
    // Deliberately not "divide by 7 and treat absent days as zero": an absent day is missing data,
    // not a day of no customers, and inventing a zero would be a different fabrication. The mean
    // stays over observed days and the count travels with it, so a caller can see when two numbers
    // are not comparable instead of silently ranking on them.
    const daysObserved = comp.days.length
    const avgPeak = daysObserved > 0
      ? Math.round(comp.days.reduce((sum, d) => sum + d.peak_score, 0) / daysObserved)
      : 0

    return {
      competitor_name: comp.competitor_name,
      busiest_day: busiest ? DAY_NAMES[busiest.day_of_week] : "N/A",
      peak_hour: busiest ? formatHour(busiest.peak_hour) : "N/A",
      peak_score: busiest?.peak_score ?? 0,
      avg_peak: avgPeak,
      days_observed: daysObserved,
      typical_time_spent: busiest?.typical_time_spent ?? null,
      current_popularity: comp.current_popularity ?? null,
    }
  }).sort((a, b) => b.peak_score - a.peak_score)
}
