// Page-local shape for the Traffic page islands. Matches the rows produced from
// the cached busy-times data in page.tsx (and the input to buildPeakData), so the
// islands don't reach into the shared components/traffic/* presentation layer.

export type TrafficDay = {
  day_of_week: number
  hourly_scores: number[]
  peak_hour: number
  peak_score: number
  typical_time_spent: string | null
}

export type TrafficData = {
  competitor_id: string
  competitor_name: string
  days: TrafficDay[]
}
