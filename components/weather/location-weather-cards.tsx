"use client"

export type LocationWeather = {
  location_id: string
  location_name: string
  date: string
  temp_high_f: number
  temp_low_f: number
  weather_condition: string
  weather_icon: string
  precipitation_in: number
  is_severe: boolean
  humidity_avg: number | null
  wind_speed_max_mph: number | null
}

type Props = {
  locations: LocationWeather[]
}

function getWeatherIconUrl(icon: string): string {
  return `https://openweathermap.org/img/wn/${icon}@2x.png`
}

export default function LocationWeatherCards({ locations }: Props) {
  if (locations.length === 0) return null

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">All Locations</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {locations.map((loc) => (
          <div
            key={loc.location_id}
            className={`rounded-xl border p-4 transition ${
              loc.is_severe
                ? "border-rose-200 bg-gradient-to-br from-rose-50 to-white"
                : "border-slate-200 bg-gradient-to-br from-slate-50 to-white"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{loc.location_name}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {new Date(loc.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getWeatherIconUrl(loc.weather_icon)}
                alt={loc.weather_condition}
                className="h-10 w-10"
              />
            </div>

            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-2xl font-bold text-slate-900">
                {Math.round(loc.temp_high_f)}°
              </span>
              <span className="text-sm text-slate-400">/</span>
              <span className="text-sm text-slate-500">
                {Math.round(loc.temp_low_f)}°
              </span>
            </div>

            <p className="mt-1 text-xs capitalize text-slate-600">
              {loc.weather_condition.toLowerCase()}
            </p>

            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400">
              {loc.humidity_avg != null && (
                <span>Humidity {loc.humidity_avg}%</span>
              )}
              {loc.wind_speed_max_mph != null && (
                <span>Wind {Math.round(loc.wind_speed_max_mph)} mph</span>
              )}
              {loc.precipitation_in > 0 && (
                <span className="font-medium text-sky-600">{loc.precipitation_in}&quot; precip</span>
              )}
            </div>

            {loc.is_severe && (
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-rose-600">
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                Severe Weather Alert
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
