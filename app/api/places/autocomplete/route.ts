import { fetchAutocomplete } from "@/lib/places/google"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const input = searchParams.get("input")?.trim()
  if (!input) {
    return new Response(JSON.stringify({ ok: false, message: "Missing input" }), {
      status: 400,
    })
  }

  try {
    const predictions = await fetchAutocomplete(input)
    return new Response(JSON.stringify({ ok: true, predictions }), { status: 200 })
  } catch (error) {
    console.error("Places autocomplete error:", error)
    return new Response(
      JSON.stringify({ ok: false, message: String(error) }),
      { status: 502 }
    )
  }
}
