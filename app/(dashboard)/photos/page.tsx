import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import LocationFilter from "@/components/ui/location-filter"
import PhotoGrid, { type PhotoGridItem } from "@/components/photos/photo-grid"
import { Card } from "@/components/ui/card"

type PhotosPageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
  }>
}

export default async function PhotosPage({ searchParams }: PhotosPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedParams?.location_id ?? locations?.[0]?.id ?? null

  const { data: competitors } = selectedLocationId
    ? await supabase
        .from("competitors")
        .select("id, name")
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { data: [] }

  const competitorIds = (competitors ?? []).map((c) => c.id)
  const competitorNameMap = new Map((competitors ?? []).map((c) => [c.id, c.name ?? "Competitor"]))

  const { data: photosRaw } = competitorIds.length > 0
    ? await supabase
        .from("competitor_photos")
        .select("id, competitor_id, image_url, image_hash, analysis_result, first_seen_at, created_at")
        .in("competitor_id", competitorIds)
        .order("created_at", { ascending: false })
    : { data: [] }

  const photos: PhotoGridItem[] = (photosRaw ?? []).map((p) => {
    const a = p.analysis_result as Record<string, unknown> | null
    const qs = a?.quality_signals as Record<string, unknown> | null
    return {
      id: p.id,
      image_url: p.image_url,
      category: (a?.category as string) ?? "other",
      subcategory: (a?.subcategory as string) ?? "",
      tags: (a?.tags as string[]) ?? [],
      extracted_text: (a?.extracted_text as string) ?? "",
      promotional_content: (a?.promotional_content as boolean) ?? false,
      promotional_details: (a?.promotional_details as string) ?? "",
      confidence: (a?.confidence as number) ?? 0,
      competitor_name: competitorNameMap.get(p.competitor_id) ?? "Competitor",
      competitor_id: p.competitor_id,
      quality_lighting: (qs?.lighting as string) ?? "unknown",
      quality_staging: (qs?.staging as string) ?? "unknown",
      first_seen_at: p.first_seen_at ?? p.created_at,
    }
  })

  // KPI calculations
  const totalPhotos = photos.length
  const categoryCounts: Record<string, number> = {}
  let promoCount = 0
  let professionalCount = 0
  for (const p of photos) {
    categoryCounts[p.category] = (categoryCounts[p.category] ?? 0) + 1
    if (p.promotional_content) promoCount++
    if (p.quality_lighting === "professional") professionalCount++
  }
  const topCategory = Object.entries(categoryCounts).sort(([, a], [, b]) => b - a)[0]
  const proRatio = totalPhotos > 0 ? Math.round((professionalCount / totalPhotos) * 100) : 0

  return (
    <section className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-pink-600 via-rose-600 to-fuchsia-600 p-6 text-white shadow-xl shadow-pink-200/50">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Visual Intelligence</h1>
            </div>
            <p className="max-w-md text-sm text-white/70">
              AI-analyzed competitor photos from Google Places for{" "}
              <span className="font-medium text-white/90">
                {locations?.find((l) => l.id === selectedLocationId)?.name ?? "your locations"}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {locations && locations.length > 1 && selectedLocationId && (
              <LocationFilter
                locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
                selectedLocationId={selectedLocationId}
              />
            )}
            {selectedLocationId && (
              <JobRefreshButton
                type="photos"
                locationId={selectedLocationId}
                label="Scan Photos"
                pendingLabel="Scanning competitor photos"
                className="!bg-white/15 !text-white backdrop-blur-sm hover:!bg-white/25"
              />
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {totalPhotos > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-white">
            <p className="text-xs font-medium text-slate-500">Total Photos</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{totalPhotos}</p>
            <p className="mt-1 text-[11px] text-slate-400">{competitorIds.length} competitors</p>
          </Card>
          <Card className="bg-white">
            <p className="text-xs font-medium text-slate-500">Top Category</p>
            <p className="mt-2 text-xl font-bold text-slate-900 capitalize">{topCategory?.[0]?.replace(/_/g, " ") ?? "N/A"}</p>
            <p className="mt-1 text-[11px] text-slate-400">{topCategory?.[1] ?? 0} photos</p>
          </Card>
          <Card className="bg-white">
            <p className="text-xs font-medium text-slate-500">Promotions Detected</p>
            <p className="mt-2 text-3xl font-bold text-rose-600">{promoCount}</p>
            <p className="mt-1 text-[11px] text-slate-400">across all competitors</p>
          </Card>
          <Card className="bg-white">
            <p className="text-xs font-medium text-slate-500">Professional Quality</p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">{proRatio}%</p>
            <p className="mt-1 text-[11px] text-slate-400">{professionalCount} of {totalPhotos} photos</p>
          </Card>
        </div>
      )}

      {/* Photo Grid */}
      {totalPhotos > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <PhotoGrid photos={photos} />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <svg className="mx-auto h-12 w-12 text-pink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-600">No photos analyzed yet</p>
          <p className="mt-1 text-xs text-slate-400">Click &quot;Scan Photos&quot; to fetch and analyze competitor photos with Vision AI</p>
        </div>
      )}
    </section>
  )
}
