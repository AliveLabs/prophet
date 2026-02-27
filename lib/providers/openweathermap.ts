const BASE_URL = "https://api.openweathermap.org/data/3.0/onecall/timemachine"

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

type HourlyEntry = {
  temp: number
  feels_like: number
  humidity: number
  wind_speed: number
  visibility?: number
  weather: Array<{ id: number; main: string; description: string; icon: string }>
  rain?: { "1h"?: number }
  snow?: { "1h"?: number }
}

type TimemachineResponse = {
  data: HourlyEntry[]
}

const SEVERE_CONDITION_IDS = new Set([
  200, 201, 202, 210, 211, 212, 221, 230, 231, 232, // thunderstorm
  502, 503, 504, 511,                                 // heavy rain / freezing rain
  602, 611, 612, 613, 615, 616, 620, 621, 622,        // heavy snow / sleet
  771, 781,                                            // squall, tornado
])

function mode<T>(arr: T[]): T {
  const counts = new Map<T, number>()
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = arr[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
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

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  date: Date
): Promise<DailyWeatherSummary> {
  const dt = Math.floor(date.getTime() / 1000)
  const dateStr = date.toISOString().split("T")[0]

  const url = `${BASE_URL}?lat=${lat}&lon=${lon}&dt=${dt}&appid=${getApiKey()}&units=metric`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenWeatherMap error ${res.status}: ${text}`)
  }

  const json = (await res.json()) as TimemachineResponse
  const hours = json.data ?? []

  if (hours.length === 0) {
    return {
      date: dateStr,
      temp_high_f: 0, temp_low_f: 0, feels_like_high_f: 0,
      humidity_avg: 0, wind_speed_max_mph: 0,
      weather_condition: "Unknown", weather_description: "No data",
      weather_icon: "01d", precipitation_in: 0, is_severe: false,
    }
  }

  const temps = hours.map(h => h.temp)
  const feelsLike = hours.map(h => h.feels_like)
  const humidities = hours.map(h => h.humidity)
  const winds = hours.map(h => h.wind_speed)
  const conditions = hours.map(h => h.weather[0]?.main ?? "Unknown")
  const descriptions = hours.map(h => h.weather[0]?.description ?? "unknown")
  const icons = hours.map(h => h.weather[0]?.icon ?? "01d")
  const weatherIds = hours.flatMap(h => h.weather.map(w => w.id))

  const totalPrecipMm = hours.reduce((sum, h) => {
    return sum + (h.rain?.["1h"] ?? 0) + (h.snow?.["1h"] ?? 0)
  }, 0)

  const isSevere = weatherIds.some(id => SEVERE_CONDITION_IDS.has(id)) ||
    celsiusToFahrenheit(Math.max(...temps)) > 105 ||
    celsiusToFahrenheit(Math.min(...temps)) < 10

  return {
    date: dateStr,
    temp_high_f: celsiusToFahrenheit(Math.max(...temps)),
    temp_low_f: celsiusToFahrenheit(Math.min(...temps)),
    feels_like_high_f: celsiusToFahrenheit(Math.max(...feelsLike)),
    humidity_avg: Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length),
    wind_speed_max_mph: msToMph(Math.max(...winds)),
    weather_condition: mode(conditions),
    weather_description: mode(descriptions),
    weather_icon: mode(icons),
    precipitation_in: mmToInches(totalPrecipMm),
    is_severe: isSevere,
  }
}
