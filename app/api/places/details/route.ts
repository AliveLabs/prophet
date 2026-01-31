import { fetchPlaceDetails, mapPlaceToLocation } from "@/lib/places/google"

export async function GET(request: Request) {
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
