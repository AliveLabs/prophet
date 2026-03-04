const BASE_URL = "https://api.app.outscraper.com/maps/search-v3"

function getApiKey(): string {
  const key = process.env.OUTSCRAPER_API_KEY
  if (!key || key === "xxx") throw new Error("OUTSCRAPER_API_KEY is not configured")
  return key
}

export type BusyTimesDay = {
  day_of_week: number
  day_name: string
  hourly_scores: number[]
  peak_hour: number
  peak_score: number
  slow_hours: number[]
}

export type BusyTimesResult = {
  competitor_id: string
  days: BusyTimesDay[]
  typical_time_spent: string | null
  current_popularity: number | null
}

type OutscraperHourEntry = {
  hour: number
  percentage: number
  time?: string
  title?: string
}

type OutscraperDayEntry = {
  day: number
  day_text: string
  popular_times: OutscraperHourEntry[]
}

type OutscraperCurrentEntry = {
  day?: number
  percentage?: number
  time?: string
  title?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OutscraperPlace = Record<string, any>

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function outscraperDayToWeekday(outsDay: number): number {
  // Outscraper uses 7=Sunday, 1=Monday..6=Saturday
  return outsDay === 7 ? 0 : outsDay
}

export async function fetchBusyTimes(
  placeId: string,
  competitorId: string
): Promise<BusyTimesResult | null> {
  const url = new URL(BASE_URL)
  url.searchParams.set("query", placeId)
  url.searchParams.set("limit", "1")
  url.searchParams.set("async", "false")

  const res = await fetch(url.toString(), {
    headers: { "X-API-KEY": getApiKey() },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outscraper error ${res.status}: ${text}`)
  }

  const json = await res.json()
  const results = Array.isArray(json) ? json : json?.data
  const place: OutscraperPlace | undefined = Array.isArray(results?.[0])
    ? results[0][0]
    : results?.[0]

  if (!place?.popular_times || !Array.isArray(place.popular_times) || place.popular_times.length === 0) {
    return null
  }

  // Separate day entries from the "current popularity" entry
  const dayEntries: OutscraperDayEntry[] = []
  let currentPopularity: number | null = null

  for (const entry of place.popular_times) {
    if (entry.day_text && Array.isArray(entry.popular_times)) {
      dayEntries.push(entry as OutscraperDayEntry)
    } else if (entry.percentage != null && entry.title) {
      currentPopularity = (entry as OutscraperCurrentEntry).percentage ?? null
    }
  }

  if (dayEntries.length === 0) return null

  const days: BusyTimesDay[] = dayEntries.map((dayEntry) => {
    // Build a 24-slot array from the hourly entries
    const scores = Array(24).fill(0)
    for (const h of dayEntry.popular_times) {
      if (h.hour >= 0 && h.hour < 24) {
        scores[h.hour] = h.percentage ?? 0
      }
    }

    const peakScore = Math.max(...scores)
    const peakHour = scores.indexOf(peakScore)
    const slowHours = scores
      .map((s: number, i: number) => (s > 0 && s < 25 ? i : -1))
      .filter((i: number) => i >= 0)

    const dayName = dayEntry.day_text || DAY_NAMES[outscraperDayToWeekday(dayEntry.day)] || "Unknown"

    return {
      day_of_week: outscraperDayToWeekday(dayEntry.day),
      day_name: dayName,
      hourly_scores: scores,
      peak_hour: peakHour,
      peak_score: peakScore,
      slow_hours: slowHours,
    }
  })

  return {
    competitor_id: competitorId,
    days,
    typical_time_spent: place.time_spent ?? null,
    current_popularity: currentPopularity,
  }
}
