// Autocomplete for the preview onboarding "find your restaurant" typeahead.
// Server-side so the Google key is never exposed to the client. Prod-guarded
// (review surface only). Degrades to an empty list on error so the typeahead
// never hard-fails.

import { fetchAutocomplete } from "@/lib/places/google"

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") return new Response("Not found", { status: 404 })
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? ""
  if (q.length < 2) return Response.json({ suggestions: [] })
  try {
    const suggestions = await fetchAutocomplete(q)
    return Response.json({ suggestions })
  } catch (e) {
    return Response.json({ suggestions: [], error: e instanceof Error ? e.message : "search failed" })
  }
}
