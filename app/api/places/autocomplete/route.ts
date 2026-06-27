import { fetchAutocomplete, type AutocompleteOptions } from "@/lib/places/google"
import { getUser } from "@/lib/auth/server"

function parseCoord(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export async function GET(request: Request) {
  // SEC-H3: spends GOOGLE_PLACES_API_KEY — require a session (all callers are post-auth: onboarding,
  // dashboard competitors, add-location). Closes the anonymous quota-drain / free-proxy vector.
  if (!(await getUser())) {
    return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const input = searchParams.get("input")?.trim()
  if (!input) {
    return new Response(JSON.stringify({ ok: false, message: "Missing input" }), {
      status: 400,
    })
  }

  const lat = parseCoord(searchParams.get("lat"))
  const lng = parseCoord(searchParams.get("lng"))
  const radius = parseCoord(searchParams.get("radius"))
  const options: AutocompleteOptions = {}
  if (lat !== undefined && lng !== undefined) {
    options.lat = lat
    options.lng = lng
    if (radius !== undefined) options.radius = radius
  }

  try {
    const predictions = await fetchAutocomplete(input, options)
    return new Response(JSON.stringify({ ok: true, predictions }), { status: 200 })
  } catch (error) {
    console.error("Places autocomplete error:", error)
    return new Response(
      JSON.stringify({ ok: false, message: String(error) }),
      { status: 502 }
    )
  }
}
