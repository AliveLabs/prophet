type WeatherData = {
  date: string
  temp_high_f: number
  temp_low_f: number
  weather_condition: string
  weather_icon: string
  precipitation_in: number
  is_severe: boolean
}

type Props = {
  weather: WeatherData | null
}

function getWeatherIconUrl(icon: string): string {
  return `https://openweathermap.org/img/wn/${icon}@2x.png`
}

export default function WeatherBadge({ weather }: Props) {
  if (!weather) return null

  return (
    <div className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
      weather.is_severe
        ? "border border-rose-200 bg-rose-50"
        : "border border-slate-200 bg-white"
    }`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getWeatherIconUrl(weather.weather_icon)}
        alt={weather.weather_condition}
        className="h-8 w-8"
      />
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-bold text-slate-900">
            {Math.round(weather.temp_high_f)}°
          </span>
          <span className="text-slate-400">/</span>
          <span className="text-slate-500">
            {Math.round(weather.temp_low_f)}°
          </span>
        </div>
        <p className="text-[10px] text-slate-500 capitalize">
          {weather.weather_condition.toLowerCase()}
          {weather.precipitation_in > 0 && ` • ${weather.precipitation_in}" precip`}
        </p>
        {weather.is_severe && (
          <span className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-600">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            Severe Weather
          </span>
        )}
      </div>
      <p className="ml-auto text-[9px] text-slate-400">
        Weather data by OpenWeatherMap
      </p>
    </div>
  )
}
