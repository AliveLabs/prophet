import { fetchWithRetry } from "@/lib/http/fetch-with-retry"

const DAY_SUMMARY_URL = "https://api.openweathermap.org/data/3.0/onecall/day_summary"
const ONECALL_URL = "https://api.openweathermap.org/data/3.0/onecall"

function getApiKey(): string {
  const key = process.env.OPENWEATHERMAP_API_KEY
  if (!key) throw new Error("OPENWEATHERMAP_API_KEY is not configured")
  return key
}

export type DailyWeatherSummary = {
  date: string
  temp_high_f: number
  temp_low_f: number
  feels_like_high_f: number
  humidity_avg: number
  wind_speed_max_mph: number
  weather_condition: string
  weather_description: string
  weather_icon: string
  precipitation_in: number
  is_severe: boolean
  /**
   * Chance of precipitation, 0-100, for FORECAST days only. `null` on historical days, where
   * the weather already happened and a probability would be meaningless.
   *
   * ALT-628: this is the field that separates "it will rain" from "it might rain", and not
   * reading it is what let a week of 0-6% days be presented to an operator as four days of rain.
   */
  precipitation_chance_pct: number | null
}

type DaySummaryResponse = {
  date: string
  temperature: {
    min: number
    max: number
    afternoon: number
    night: number
    evening: number
    morning: number
  }
  precipitation: { total: number }
  humidity: { afternoon: number }
  wind: { max: { speed: number; direction: number } }
  cloud_cover: { afternoon: number }
}

function celsiusToFahrenheit(c: number): number {
  return +(c * 9 / 5 + 32).toFixed(1)
}

function msToMph(ms: number): number {
  return +(ms * 2.237).toFixed(1)
}

function mmToInches(mm: number): number {
  return +(mm / 25.4).toFixed(2)
}

function deriveWeatherCondition(
  precipMm: number,
  cloudCover: number,
  tempMinC: number,
): { condition: string; description: string; icon: string } {
  const isSnowTemp = tempMinC < 2

  if (precipMm > 10) {
    if (isSnowTemp) return { condition: "Snow", description: "heavy snow", icon: "13d" }
    return { condition: "Rain", description: "heavy rain", icon: "10d" }
  }
  if (precipMm > 2) {
    if (isSnowTemp) return { condition: "Snow", description: "snow", icon: "13d" }
    return { condition: "Rain", description: "moderate rain", icon: "10d" }
  }
  if (precipMm > 0) {
    if (isSnowTemp) return { condition: "Snow", description: "light snow", icon: "13d" }
    return { condition: "Drizzle", description: "light rain", icon: "09d" }
  }
  if (cloudCover > 80) return { condition: "Clouds", description: "overcast clouds", icon: "04d" }
  if (cloudCover > 50) return { condition: "Clouds", description: "broken clouds", icon: "03d" }
  if (cloudCover > 20) return { condition: "Clouds", description: "scattered clouds", icon: "02d" }
  return { condition: "Clear", description: "clear sky", icon: "01d" }
}

// ---------------------------------------------------------------------------
// Is this day actually wet? (pure, unit-tested — ALT-628)
//
// OpenWeather's DAILY `weather[0]` names the most significant condition that MAY occur that
// day, not the one that will. A day with a 6% chance of a passing shower still comes back as
// `main: "Rain"`. We rendered that label verbatim, counted it into a "consecutive rainy days"
// streak, and told an operator to expect four days of rain on a week that was 0-6% chance
// throughout. `pop` (probability of precipitation) was sitting in the response the whole time.
//
// So a day is only CALLED wet when the forecast supports it, and a severe-weather alert needs
// a higher bar again: a false severe banner is the one that erodes trust fastest, because the
// operator can look out of the window and see it is wrong.
// ---------------------------------------------------------------------------

/** Below this chance, forecasters say "slight chance", not "rain". Neither do we. */
export const WET_LABEL_MIN_CHANCE_PCT = 30
/** A severe-weather ALERT is a call to action, so it needs the condition to be more likely than not. */
export const SEVERE_MIN_CHANCE_PCT = 50
/** Enough accumulation that the day is wet regardless of what the stated chance says. */
const DEFINITELY_WET_MM = 2

const PRECIPITATION_CONDITIONS = new Set(["rain", "drizzle", "snow", "sleet", "thunderstorm", "squall"])

/** True when the reported condition is a precipitation type, i.e. a claim that it will be wet. */
export function isPrecipitationCondition(condition: string): boolean {
  return PRECIPITATION_CONDITIONS.has((condition ?? "").trim().toLowerCase())
}

export type ForecastConditionInput = {
  /** OpenWeather's reported condition for the day, if present. */
  reported: { id: number; main: string; description: string; icon: string } | undefined
  /** Chance of precipitation 0-100, or null when the source gave none. */
  chancePct: number | null
  /** Expected accumulation in mm (rain + snow). */
  precipMm: number
  cloudCoverPct: number
  tempMinC: number
  tempHighF: number
  tempLowF: number
}

export type ForecastCondition = {
  condition: string
  description: string
  icon: string
  isSevere: boolean
}

/**
 * The day's condition as we are willing to state it, plus whether it warrants a severe alert.
 *
 * A reported precipitation label survives only when the forecast backs it. When it does not,
 * the day is described by what we DO know (cloud cover), never by a wetter guess. With no
 * probability available at all we fall back to accumulation, which is how the historical path
 * has always worked and is correct there: those days already happened.
 */
export function resolveForecastCondition(input: ForecastConditionInput): ForecastCondition {
  const { reported, chancePct, precipMm, cloudCoverPct, tempMinC, tempHighF, tempLowF } = input

  const wetEnough =
    precipMm >= DEFINITELY_WET_MM ||
    (chancePct === null ? precipMm > 0 : chancePct >= WET_LABEL_MIN_CHANCE_PCT)

  const claimsPrecipitation = isPrecipitationCondition(reported?.main ?? "")

  // Temperature extremes are not probabilistic: they are the forecast high and low, so they
  // flag severe on their own. A convective condition id has to clear the chance bar.
  const severeCondition =
    reported !== undefined &&
    SEVERE_CONDITION_IDS.has(reported.id) &&
    (chancePct === null || chancePct >= SEVERE_MIN_CHANCE_PCT)
  const isSevere = severeCondition || tempHighF > 105 || tempLowF < 10

  if (claimsPrecipitation && !wetEnough) {
    // Downgrade to the sky we can actually vouch for.
    const derived = deriveWeatherCondition(0, cloudCoverPct, tempMinC)
    return { ...derived, isSevere }
  }

  return {
    condition: reported?.main ?? "Unknown",
    description: reported?.description ?? "unknown",
    icon: reported?.icon ?? "01d",
    isSevere,
  }
}

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  date: Date
): Promise<DailyWeatherSummary> {
  const dateStr = date.toISOString().split("T")[0]

  const url = `${DAY_SUMMARY_URL}?lat=${lat}&lon=${lon}&date=${dateStr}&appid=${getApiKey()}&units=metric`
  const res = await fetchWithRetry(url, {}, { timeoutMs: 15_000, label: "openweathermap" })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenWeatherMap error ${res.status}: ${text}`)
  }

  const json = (await res.json()) as DaySummaryResponse

  const tempMinC = json.temperature?.min ?? 0
  const tempMaxC = json.temperature?.max ?? 0
  const precipMm = json.precipitation?.total ?? 0
  const cloudCover = json.cloud_cover?.afternoon ?? 0
  const humidityPct = json.humidity?.afternoon ?? 0
  const windMaxMs = json.wind?.max?.speed ?? 0

  const highF = celsiusToFahrenheit(tempMaxC)
  const lowF = celsiusToFahrenheit(tempMinC)

  const { condition, description, icon } = deriveWeatherCondition(precipMm, cloudCover, tempMinC)

  const isSevere = highF > 105 || lowF < 10 ||
    precipMm > 50 || msToMph(windMaxMs) > 50

  const feelsLikeAfternoonC = json.temperature?.afternoon ?? tempMaxC

  return {
    date: dateStr,
    temp_high_f: highF,
    temp_low_f: lowF,
    feels_like_high_f: celsiusToFahrenheit(feelsLikeAfternoonC),
    humidity_avg: Math.round(humidityPct),
    wind_speed_max_mph: msToMph(windMaxMs),
    weather_condition: condition,
    weather_description: description,
    weather_icon: icon,
    precipitation_in: mmToInches(precipMm),
    is_severe: isSevere,
    // This day already happened: it either rained or it did not, so there is no chance to state.
    precipitation_chance_pct: null,
  }
}

// ---------------------------------------------------------------------------
// Forecast – One Call API 3.0 daily forecast (up to 8 days)
// ---------------------------------------------------------------------------

const SEVERE_CONDITION_IDS = new Set([
  200, 201, 202, 210, 211, 212, 221, 230, 231, 232, // thunderstorm
  502, 503, 504, 511,                                 // heavy rain / freezing rain
  602, 611, 612, 613, 615, 616, 620, 621, 622,        // heavy snow / sleet
  771, 781,                                            // squall, tornado
])

type ForecastDailyEntry = {
  dt: number
  temp: { min: number; max: number; day: number }
  feels_like: { day: number; night: number; eve: number; morn: number }
  humidity: number
  wind_speed: number
  weather: Array<{ id: number; main: string; description: string; icon: string }>
  clouds?: number
  rain?: number
  snow?: number
  /** Probability of precipitation, 0-1. */
  pop?: number
}

type OneCallResponse = {
  daily?: ForecastDailyEntry[]
}

export async function fetchForecast(
  lat: number,
  lon: number
): Promise<DailyWeatherSummary[]> {
  const url = `${ONECALL_URL}?lat=${lat}&lon=${lon}&exclude=minutely,hourly,alerts,current&appid=${getApiKey()}&units=metric`
  const res = await fetchWithRetry(url, { next: { revalidate: 3600 } }, { timeoutMs: 15_000, label: "openweathermap" })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenWeatherMap forecast error ${res.status}: ${text}`)
  }

  const json = (await res.json()) as OneCallResponse
  const days = json.daily ?? []

  return days.map((d) => {
    const dateObj = new Date(d.dt * 1000)
    const dateStr = dateObj.toISOString().split("T")[0]

    const highF = celsiusToFahrenheit(d.temp.max)
    const lowF = celsiusToFahrenheit(d.temp.min)
    const totalPrecipMm = (d.rain ?? 0) + (d.snow ?? 0)
    const chancePct =
      typeof d.pop === "number" && Number.isFinite(d.pop)
        ? Math.round(Math.min(Math.max(d.pop, 0), 1) * 100)
        : null

    // ALT-628: the reported label only stands if the forecast supports it.
    const resolved = resolveForecastCondition({
      reported: d.weather[0],
      chancePct,
      precipMm: totalPrecipMm,
      cloudCoverPct: d.clouds ?? 0,
      tempMinC: d.temp.min,
      tempHighF: highF,
      tempLowF: lowF,
    })

    return {
      date: dateStr,
      temp_high_f: highF,
      temp_low_f: lowF,
      feels_like_high_f: celsiusToFahrenheit(
        Math.max(d.feels_like.day, d.feels_like.morn, d.feels_like.eve, d.feels_like.night)
      ),
      humidity_avg: d.humidity,
      wind_speed_max_mph: msToMph(d.wind_speed),
      weather_condition: resolved.condition,
      weather_description: resolved.description,
      weather_icon: resolved.icon,
      precipitation_in: mmToInches(totalPrecipMm),
      is_severe: resolved.isSevere,
      precipitation_chance_pct: chancePct,
    }
  })
}
