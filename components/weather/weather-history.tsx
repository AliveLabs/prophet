"use client"

import { useSyncExternalStore } from "react"

export type WeatherDay = {
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
  days: WeatherDay[]
  locationName: string
}

function getWeatherIconUrl(icon: string): string {
  return `https://openweathermap.org/img/wn/${icon}@2x.png`
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

export default function WeatherHistory({ days, locationName }: Props) {
  const isClient = useIsClient()

  if (!isClient) return <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
  if (days.length === 0) return null

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const maxTemp = Math.max(...sorted.map((d) => d.temp_high_f), 100)
  const minTemp = Math.min(...sorted.map((d) => d.temp_low_f), 0)
  const tempRange = maxTemp - minTemp || 1
  const maxPrecip = Math.max(...sorted.map((d) => d.precipitation_in), 0.1)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-slate-900">Weather History</h3>
        <span className="text-xs text-slate-400">{locationName} · Last {sorted.length} day{sorted.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex min-w-[500px] items-end gap-2" style={{ height: 180 }}>
          {sorted.map((day) => {
            const highPct = ((day.temp_high_f - minTemp) / tempRange) * 100
            const lowPct = ((day.temp_low_f - minTemp) / tempRange) * 100
            const precipPct = (day.precipitation_in / maxPrecip) * 40
            const dateLabel = new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

            return (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                {/* Temperature range bar */}
                <div className="relative flex w-full flex-col items-center" style={{ height: 120 }}>
                  <div className="absolute bottom-0 left-1/2 w-3 -translate-x-1/2 rounded-full" style={{
                    height: `${highPct - lowPct + 8}%`,
                    bottom: `${lowPct}%`,
                    background: day.is_severe
                      ? "linear-gradient(to top, #fda4af, #e11d48)"
                      : "linear-gradient(to top, #93c5fd, #f97316)",
                  }} />
                  <div className="absolute text-[9px] font-bold text-orange-600" style={{ bottom: `${highPct + 2}%` }}>
                    {Math.round(day.temp_high_f)}°
                  </div>
                  <div className="absolute text-[9px] font-medium text-blue-500" style={{ bottom: `${Math.max(lowPct - 8, 0)}%` }}>
                    {Math.round(day.temp_low_f)}°
                  </div>
                </div>

                {/* Precip bar */}
                {day.precipitation_in > 0 && (
                  <div className="w-full px-1">
                    <div
                      className="mx-auto w-2 rounded-t bg-sky-400"
                      style={{ height: Math.max(precipPct, 3) }}
                      title={`${day.precipitation_in}" precipitation`}
                    />
                  </div>
                )}

                {/* Icon + date */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getWeatherIconUrl(day.weather_icon)}
                  alt={day.weather_condition}
                  className="h-6 w-6"
                />
                <span className="text-[9px] text-slate-500">{dateLabel}</span>
                {day.is_severe && (
                  <span className="rounded bg-rose-100 px-1 py-0.5 text-[8px] font-bold text-rose-600">
                    SEVERE
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-slate-400">
        <div className="flex items-center gap-1">
          <div className="h-2 w-4 rounded bg-gradient-to-r from-blue-300 to-orange-400" />
          Temperature range
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-4 rounded bg-sky-400" />
          Precipitation
        </div>
        <span className="ml-auto">Data: OpenWeatherMap</span>
      </div>
    </div>
  )
}
