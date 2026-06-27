import { fetchPlaceDetails, mapPlaceToLocation } from "@/lib/places/google"
import { getUser } from "@/lib/auth/server"
import { rateLimit, retryAfterSeconds } from "@/lib/http/rate-limit"

export async function GET(request: Request) {
  // SEC-H3: spends GOOGLE_PLACES_API_KEY — require a session (callers are post-auth UIs). The one
  // server-side caller, competitors/actions.ts, now calls the lib directly instead of self-fetching.
  const user = await getUser()
  if (!user) {
    return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), { status: 401 })
  }
  const rl = await rateLimit(user.id, { prefix: "places-details", limit: 60, windowSeconds: 60 })
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, message: "Too many requests" }), {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds(rl)) },
    })
  }
  const { searchParams } = new URL(request.url)
  const placeId = searchParams.get("place_id")?.trim()
  if (!placeId) {
    return new Response(JSON.stringify({ ok: false, message: "Missing place_id" }), {
      status: 400,
    })
  }

  try {
    const result = await fetchPlaceDetails(placeId)
    if (!result) {
      return new Response(
        JSON.stringify({ ok: false, message: "Place not found" }),
        { status: 404 }
      )
    }
    return new Response(
      JSON.stringify({ ok: true, place: mapPlaceToLocation(result) }),
      { status: 200 }
    )
  } catch (error) {
    console.error("Places details error:", error)
    return new Response(
      JSON.stringify({ ok: false, message: String(error) }),
      { status: 502 }
    )
  }
}
