import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import LocationFilter from "@/components/ui/location-filter"
import PhotoGrid, { type PhotoGridItem } from "@/components/photos/photo-grid"
import VisualInsightsCards from "@/components/photos/visual-insights-cards"
import { Card } from "@/components/ui/card"
import { fetchPhotosPageData } from "@/lib/cache/photos"

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

  // Fetch photos + insights (cached, 7-day TTL)
  const cached = await fetchPhotosPageData(selectedLocationId ?? "", competitorIds)

  const photos: PhotoGridItem[] = cached.photos.map((p) => {
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

  const photoInsights = cached.insights.map((ins) => ({
    id: ins.id,
    title: ins.title,
    summary: ins.summary,
    severity: ins.severity,
    insight_type: ins.insight_type as string,
    date_key: ins.date_key as string,
    evidence: (ins.evidence ?? {}) as Record<string, unknown>,
    recommendations: (ins.recommendations ?? []) as Array<{ title?: string; rationale?: string }>,
  }))

  // -------------------------------------------------------------------------
  // Compute aggregate visual intelligence metrics
  // -------------------------------------------------------------------------
  const categoryByCompetitor = new Map<string, { name: string; cats: Record<string, number>; total: number }>()
  const qualityByCompetitor = new Map<string, { name: string; professional: number; styled: number; total: number }>()
  const promoByCompetitor = new Map<string, { name: string; count: number; details: string[] }>()

  for (const p of photos) {
    const key = p.competitor_id

    if (!categoryByCompetitor.has(key)) {
      categoryByCompetitor.set(key, { name: p.competitor_name, cats: {}, total: 0 })
    }
    const catEntry = categoryByCompetitor.get(key)!
    catEntry.cats[p.category] = (catEntry.cats[p.category] ?? 0) + 1
    catEntry.total += 1

    if (!qualityByCompetitor.has(key)) {
      qualityByCompetitor.set(key, { name: p.competitor_name, professional: 0, styled: 0, total: 0 })
    }
    const qEntry = qualityByCompetitor.get(key)!
    qEntry.total += 1
    if (p.quality_lighting === "professional") qEntry.professional += 1
    if (p.quality_staging === "styled") qEntry.styled += 1

    if (p.promotional_content) {
      if (!promoByCompetitor.has(key)) {
        promoByCompetitor.set(key, { name: p.competitor_name, count: 0, details: [] })
      }
      const pEntry = promoByCompetitor.get(key)!
      pEntry.count += 1
      if (p.promotional_details) pEntry.details.push(p.promotional_details)
    }
  }

  const categoryDistributions = [...categoryByCompetitor.values()].map((v) => ({
    competitorName: v.name,
    categories: v.cats,
    total: v.total,
  }))

  const qualityBenchmarks = [...qualityByCompetitor.values()]
    .map((v) => ({
      competitorName: v.name,
      professionalPct: v.total > 0 ? Math.round((v.professional / v.total) * 100) : 0,
      styledPct: v.total > 0 ? Math.round((v.styled / v.total) * 100) : 0,
      total: v.total,
    }))
    .sort((a, b) => b.professionalPct - a.professionalPct)

  const promoActivity = [...promoByCompetitor.values()]
    .map((v) => ({
      competitorName: v.name,
      promoCount: v.count,
      details: v.details,
    }))
    .sort((a, b) => b.promoCount - a.promoCount)

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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-signal-gold via-destructive to-primary p-6 text-white shadow-xl shadow-card-sm">
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
              <h1 className="text-xl font-display font-bold tracking-tight">Visual Intelligence</h1>
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
          <Card className="bg-card">
            <p className="text-xs font-medium text-muted-foreground">Total Photos</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{totalPhotos}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{competitorIds.length} competitors</p>
          </Card>
          <Card className="bg-card">
            <p className="text-xs font-medium text-muted-foreground">Top Category</p>
            <p className="mt-2 text-xl font-bold text-foreground capitalize">{topCategory?.[0]?.replace(/_/g, " ") ?? "N/A"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{topCategory?.[1] ?? 0} photos</p>
          </Card>
          <Card className="bg-card">
            <p className="text-xs font-medium text-muted-foreground">Promotions Detected</p>
            <p className="mt-2 text-3xl font-bold text-destructive">{promoCount}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">across all competitors</p>
          </Card>
          <Card className="bg-card">
            <p className="text-xs font-medium text-muted-foreground">Professional Quality</p>
            <p className="mt-2 text-3xl font-bold text-precision-teal">{proRatio}%</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{professionalCount} of {totalPhotos} photos</p>
          </Card>
        </div>
      )}

      {/* Visual Intelligence Insight Cards */}
      {totalPhotos > 0 && (
        <VisualInsightsCards
          insights={photoInsights}
          categoryDistributions={categoryDistributions}
          qualityBenchmarks={qualityBenchmarks}
          promoActivity={promoActivity}
        />
      )}

      {/* Photo Grid */}
      {totalPhotos > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <PhotoGrid photos={photos} />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <svg className="mx-auto h-12 w-12 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-muted-foreground">No photos analyzed yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Click &quot;Scan Photos&quot; to fetch and analyze competitor photos with Vision AI</p>
        </div>
      )}
    </section>
  )
}
