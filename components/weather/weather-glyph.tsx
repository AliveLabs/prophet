import { weatherIconKind, type WeatherIconKind } from "@/lib/weather/icon-kind"

// Local weather glyph. Replaces hotlinked provider icon images so no vendor domain
// appears in the DOM or the customer's network tab. Paths match the set already used by
// TkWeatherStrip so the forecast strip and these cards read as one system.
const GLYPHS: Record<WeatherIconKind, React.ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </>
  ),
  cloud: <path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 18z" />,
  rain: (
    <>
      <path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 14z" />
      <path d="M8 18v2M12 18v3M16 18v2" />
    </>
  ),
  storm: (
    <>
      <path d="M17 16a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 16z" />
      <path d="M11 14l-2 4h3l-2 4" />
    </>
  ),
}

export function WeatherGlyph({
  code,
  label,
  className = "h-8 w-8",
}: {
  /** Stored weather_icon code, e.g. "10d". */
  code: string | null | undefined
  /** Human condition text, used as the accessible name (was the <img> alt). */
  label?: string | null
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      {GLYPHS[weatherIconKind(code)]}
    </svg>
  )
}
