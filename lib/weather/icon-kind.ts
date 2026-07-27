// Maps a stored weather icon code to one of our four local glyph kinds.
//
// The weather cards, badge, and history table used to hotlink the provider's icon CDN
// (`https://<provider>.org/img/wn/<code>@2x.png`). That put the vendor's domain in the DOM
// and in every customer's network tab — the same exposure as naming them in copy, just
// harder to spot. We render our own SVG instead, so nothing leaves our origin.
//
// Codes follow the widely-used `NNd` / `NNn` convention (day/night suffix) that our stored
// `location_weather.weather_icon` values use.

export type WeatherIconKind = "sun" | "cloud" | "rain" | "storm"

export function weatherIconKind(code: string | null | undefined): WeatherIconKind {
  const n = (code ?? "").slice(0, 2)
  switch (n) {
    case "01":
      return "sun"
    case "02":
    case "03":
    case "04":
      return "cloud"
    case "09":
    case "10":
      return "rain"
    case "11":
      return "storm"
    // Snow (13) and atmospheric/mist (50) have no dedicated glyph; "cloud" is the honest
    // neutral rather than implying clear skies.
    case "13":
    case "50":
      return "cloud"
    default:
      return "cloud"
  }
}
