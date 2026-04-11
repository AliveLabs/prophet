"use client"

import { useSyncExternalStore } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts"

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
  isForecast?: boolean
}

type Props = {
  days: WeatherDay[]
  locationName: string
  todayDate?: string
}

type ChartRow = {
  date: string
  label: string
  tempRange: [number, number]
  high: number
  low: number
  precipitation: number
  humidity: number | null
  wind: number | null
  condition: string
  icon: string
  isForecast: boolean
  isSevere: boolean
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ChartRow }> }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xl">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://openweathermap.org/img/wn/${row.icon}@2x.png`}
          alt={row.condition}
          className="h-8 w-8"
        />
        <div>
          <p className="text-xs font-bold text-foreground">
            {new Date(row.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "short", month: "short", day: "numeric",
            })}
            {row.isForecast && (
              <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                FORECAST
              </span>
            )}
          </p>
          <p className="text-[11px] capitalize text-muted-foreground">{row.condition.toLowerCase()}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">High</span>
        <span className="font-semibold text-signal-gold">{Math.round(row.high)}°F</span>
        <span className="text-muted-foreground">Low</span>
        <span className="font-semibold text-primary">{Math.round(row.low)}°F</span>
        {row.precipitation > 0 && (
          <>
            <span className="text-muted-foreground">Precip</span>
            <span className="font-semibold text-primary">{row.precipitation.toFixed(2)}&quot;</span>
          </>
        )}
        {row.humidity != null && (
          <>
            <span className="text-muted-foreground">Humidity</span>
            <span className="font-medium text-muted-foreground">{row.humidity}%</span>
          </>
        )}
        {row.wind != null && (
          <>
            <span className="text-muted-foreground">Wind</span>
            <span className="font-medium text-muted-foreground">{Math.round(row.wind)} mph</span>
          </>
        )}
      </div>
      {row.isSevere && (
        <div className="mt-2 flex items-center gap-1 rounded-lg bg-destructive/15 px-2 py-1 text-[10px] font-bold text-destructive">
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          Severe Weather
        </div>
      )}
    </div>
  )
}

export default function WeatherHistory({ days, locationName, todayDate }: Props) {
  const isClient = useIsClient()

  if (!isClient) return <div className="h-80 animate-pulse rounded-2xl bg-secondary" />
  if (days.length === 0) return null

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))

  const chartData: ChartRow[] = sorted.map((d) => ({
    date: d.date,
    label: formatDateLabel(d.date),
    tempRange: [d.temp_low_f, d.temp_high_f],
    high: d.temp_high_f,
    low: d.temp_low_f,
    precipitation: d.precipitation_in,
    humidity: d.humidity_avg,
    wind: d.wind_speed_max_mph,
    condition: d.weather_condition,
    icon: d.weather_icon,
    isForecast: d.isForecast ?? false,
    isSevere: d.is_severe,
  }))

  const allTemps = sorted.flatMap((d) => [d.temp_high_f, d.temp_low_f])
  const minY = Math.floor(Math.min(...allTemps) / 5) * 5 - 5
  const maxY = Math.ceil(Math.max(...allTemps) / 5) * 5 + 5

  const histCount = sorted.filter((d) => !d.isForecast).length
  const forecastCount = sorted.filter((d) => d.isForecast).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-foreground">Weather Trend</h3>
          <span className="text-xs text-muted-foreground">
            {locationName} · {histCount} day{histCount !== 1 ? "s" : ""} history
            {forecastCount > 0 && ` + ${forecastCount} day forecast`}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="h-2.5 w-5 rounded-sm bg-gradient-to-t from-blue-200 to-orange-200" />
            Temp range
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
            Precipitation
          </div>
          {forecastCount > 0 && (
            <div className="flex items-center gap-1">
              <div className="h-2.5 w-5 rounded-sm border border-dashed border-border bg-primary/10" />
              Forecast
            </div>
          )}
        </div>
      </div>

      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#DC2626" stopOpacity={0.35} />
              <stop offset="50%" stopColor="#D4880A" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#2B353F" stopOpacity={0.25} />
              </linearGradient>
              <linearGradient id="precipGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3D4B58" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#3D4B58" stopOpacity={0.3} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#F2ECE6" vertical={false} />

            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#726A63" }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 10) - 1)}
            />
            <YAxis
              yAxisId="temp"
              domain={[minY, maxY]}
              tick={{ fontSize: 10, fill: "#726A63" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}°`}
              width={40}
            />
            <YAxis
              yAxisId="precip"
              orientation="right"
              tick={{ fontSize: 10, fill: "#726A63" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}"`}
              width={36}
            />

            <Tooltip content={<CustomTooltip />} />

            {todayDate && (
              <ReferenceLine
                yAxisId="temp"
                x={formatDateLabel(todayDate)}
                stroke="#2B353F"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                label={{
                  value: "Today",
                  position: "top",
                  fill: "#2B353F",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
            )}

            <Area
              yAxisId="temp"
              dataKey="tempRange"
              fill="url(#tempGrad)"
              stroke="none"
              activeDot={false}
              isAnimationActive={false}
            />

            <Line
              yAxisId="temp"
              dataKey="high"
              stroke="#DC2626"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#DC2626", strokeWidth: 0 }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="temp"
              dataKey="low"
              stroke="#2B353F"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#2B353F", strokeWidth: 0 }}
              isAnimationActive={false}
            />

            <Bar
              yAxisId="precip"
              dataKey="precipitation"
              fill="url(#precipGrad)"
              radius={[3, 3, 0, 0]}
              maxBarSize={12}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-right text-[10px] text-muted-foreground">Data: OpenWeatherMap</p>
    </div>
  )
}
