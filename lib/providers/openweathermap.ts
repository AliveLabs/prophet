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

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  date: Date
): Promise<DailyWeatherSummary> {
  const dateStr = date.toISOString().split("T")[0]

  const url = `${DAY_SUMMARY_URL}?lat=${lat}&lon=${lon}&date=${dateStr}&appid=${getApiKey()}&units=metric`
  const res = await fetch(url)
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
  rain?: number
  snow?: number
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
  const res = await fetch(url, { next: { revalidate: 3600 } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenWeatherMap forecast error ${res.status}: ${text}`)
  }

  const json = (await res.json()) as OneCallResponse
  const days = json.daily ?? []

  return days.map((d) => {
    const dateObj = new Date(d.dt * 1000)
    const dateStr = dateObj.toISOString().split("T")[0]
    const weatherIds = d.weather.map((w) => w.id)

    const highF = celsiusToFahrenheit(d.temp.max)
    const lowF = celsiusToFahrenheit(d.temp.min)
    const isSevere = weatherIds.some((id) => SEVERE_CONDITION_IDS.has(id)) ||
      highF > 105 || lowF < 10

    const totalPrecipMm = (d.rain ?? 0) + (d.snow ?? 0)

    return {
      date: dateStr,
      temp_high_f: highF,
      temp_low_f: lowF,
      feels_like_high_f: celsiusToFahrenheit(
        Math.max(d.feels_like.day, d.feels_like.morn, d.feels_like.eve, d.feels_like.night)
      ),
      humidity_avg: d.humidity,
      wind_speed_max_mph: msToMph(d.wind_speed),
      weather_condition: d.weather[0]?.main ?? "Unknown",
      weather_description: d.weather[0]?.description ?? "unknown",
      weather_icon: d.weather[0]?.icon ?? "01d",
      precipitation_in: mmToInches(totalPrecipMm),
      is_severe: isSevere,
    }
  })
}
