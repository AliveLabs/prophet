type WeatherApiResponse = {
  isDaytime?: boolean
  weatherCondition?: {
    iconBaseUri?: string
    description?: {
      text?: string
    }
    type?: string
  }
  temperature?: {
    degrees?: number
    unit?: string
  }
  feelsLikeTemperature?: {
    degrees?: number
    unit?: string
  }
  relativeHumidity?: number
  wind?: {
    speed?: {
      value?: number
      unit?: string
    }
    direction?: {
      cardinal?: string
    }
  }
  precipitation?: {
    probability?: {
      percent?: number
      type?: string
    }
  }
  cloudCover?: number
  uvIndex?: number
}

export type WeatherSnapshot = {
  condition: string | null
  iconUrl: string | null
  isDaytime: boolean | null
  temperature: number | null
  tempUnit: string | null
  feelsLike: number | null
  humidity: number | null
  windSpeed: number | null
  windUnit: string | null
  windDirection: string | null
  precipitationChance: number | null
  precipitationType: string | null
  cloudCover: number | null
  uvIndex: number | null
}

function getGoogleKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    return null
  }
  return key
}

function toIconUrl(baseUri?: string, useDark = false) {
  if (!baseUri) return null
  const suffix = useDark ? "_dark.svg" : ".svg"
  return `${baseUri}${suffix}`
}

export async function fetchCurrentConditions(input: {
  lat: number
  lng: number
  unitsSystem?: "METRIC" | "IMPERIAL"
}): Promise<WeatherSnapshot | null> {
  const key = getGoogleKey()
  if (!key) {
    return null
  }

  const url = new URL("https://weather.googleapis.com/v1/currentConditions:lookup")
  url.searchParams.set("key", key)
  url.searchParams.set("location.latitude", input.lat.toString())
  url.searchParams.set("location.longitude", input.lng.toString())
  url.searchParams.set("unitsSystem", input.unitsSystem ?? "IMPERIAL")

  const response = await fetch(url.toString(), { next: { revalidate: 1800 } })
  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as WeatherApiResponse

  return {
    condition: data.weatherCondition?.description?.text ?? null,
    iconUrl: toIconUrl(data.weatherCondition?.iconBaseUri, false),
    isDaytime: typeof data.isDaytime === "boolean" ? data.isDaytime : null,
    temperature: data.temperature?.degrees ?? null,
    tempUnit: data.temperature?.unit ?? null,
    feelsLike: data.feelsLikeTemperature?.degrees ?? null,
    humidity: data.relativeHumidity ?? null,
    windSpeed: data.wind?.speed?.value ?? null,
    windUnit: data.wind?.speed?.unit ?? null,
    windDirection: data.wind?.direction?.cardinal ?? null,
    precipitationChance: data.precipitation?.probability?.percent ?? null,
    precipitationType: data.precipitation?.probability?.type ?? null,
    cloudCover: data.cloudCover ?? null,
    uvIndex: data.uvIndex ?? null,
  }
}
