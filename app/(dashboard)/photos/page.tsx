// The Pass — Photos, REBUILT to Concept A's structure.
//
// Structure rebuild (not a reskin): the .pv-page title chrome → a glass toolbar
// (location filter) → a weighted at-a-glance WIDGET grid (the KPI aggregates)
// → kit intel PANELS (visual mix / quality benchmark / promo / changes)
// → the gallery in a soft card → honest empty / still-learning states. All data
// fetching, aggregation, and the server-action wiring are UNCHANGED — only the
// presentation moves to the kit. Honest framing: %/estimated, "you vs competitor",
// no fabricated $ or covers. ALT-268 removed the per-surface manual "Scan photos"
// refresh button (photos refresh daily via cron).

import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import LocationFilter from "@/components/ui/location-filter"
import PhotoGrid, { type PhotoGridItem } from "@/components/photos/photo-grid"
import PhotoIntel from "./photo-intel"
import { fetchPhotosPageData } from "@/lib/cache/photos"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkWidgetGrid,
  TkWidget,
  TkEmptyState,
  TkStillLearning,
  TkRule,
} from "@/components/ticket"
import "./photos.css"

type PhotosPageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
  }>
}

const CATEGORY_LABELS: Record<string, string> = {
  food_dish: "Food & Dishes",
  menu_board: "Menu Board",
  interior: "Interior",
  exterior: "Exterior",
  patio_outdoor: "Patio & Outdoor",
  bar_drinks: "Bar & Drinks",
  staff_team: "Staff & Team",
  event_promotion: "Event / Promo",
  signage: "Signage",
  renovation: "Renovation",
  seasonal_decor: "Seasonal",
  customer_atmosphere: "Atmosphere",
  other: "Other",
}

const CAMERA_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path d="M6.83 6.18a2.31 2.31 0 0 1-1.64 1.05c-.38.05-.76.11-1.13.18C2.99 7.58 2.25 8.5 2.25 9.57V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.57c0-1.07-.75-1.99-1.8-2.17a47.9 47.9 0 0 0-1.14-.17 2.31 2.31 0 0 1-1.64-1.06l-.82-1.31a2.19 2.19 0 0 0-1.74-1.04 48.8 48.8 0 0 0-5.23 0 2.19 2.19 0 0 0-1.74 1.04l-.82 1.31z" />
    <path d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0z" />
  </svg>
)

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
  const requestedLocationId = resolvedParams?.location_id ?? null
  const selectedLocationId = (requestedLocationId && locations?.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locations?.[0]?.id ?? null

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
  const topCategoryLabel = topCategory
    ? CATEGORY_LABELS[topCategory[0]] ?? topCategory[0].replace(/_/g, " ")
    : "—"
  const proRatio = totalPhotos > 0 ? Math.round((professionalCount / totalPhotos) * 100) : 0

  const showFilter = !!(locations && locations.length > 1 && selectedLocationId)

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Visual intelligence</span>
        <h1 className="pv-h1">Photos</h1>
        <p className="pv-sub">
          Every competitor photo we can see, read by vision AI — what they shoot, how well they shoot
          it, and the promotions they&apos;re running. We surface anything that moves into your brief.
        </p>
      </div>
      <TkRule />

      <div className="tk-kit" style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 24 }}>
        {/* ── Toolbar ── */}
        <RevealOnView className="photos-toolbar">
          <span className="photos-toolbar-lead">
            <span className="photos-live-dot" aria-hidden="true" />
            {totalPhotos > 0
              ? `${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} analyzed`
              : "Watching for photos"}
          </span>
          <div className="photos-toolbar-actions">
            {showFilter && (
              <LocationFilter
                locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
                selectedLocationId={selectedLocationId!}
              />
            )}
          </div>
        </RevealOnView>

        {totalPhotos > 0 ? (
          <>
            {/* ── At-a-glance widgets ── */}
            <RevealOnView>
              <TkWidgetGrid>
                <TkWidget
                  tone="rust"
                  size="wide"
                  label="Photos read"
                  value={String(totalPhotos)}
                  sub={`across ${competitorIds.length} competitor${competitorIds.length === 1 ? "" : "s"} we watch`}
                  data-tip="Competitor photos analyzed by vision AI"
                  data-tipv={`${totalPhotos} analyzed`}
                  spark={
                    <svg viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
                      <path
                        d="M0 48 L28 44 L52 38 L74 22 L98 14 L120 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                    </svg>
                  }
                />
                <TkWidget
                  tone="teal"
                  label="Top subject"
                  value={topCategory ? String(topCategory[1]) : "—"}
                  sub={topCategory ? `${topCategoryLabel} — most-shot` : "no photos yet"}
                  data-tip="Most-photographed subject across the set"
                  data-tipv={topCategory ? `${topCategoryLabel} · ${topCategory[1]} photos` : "no photos yet"}
                />
                <TkWidget
                  tone="slate"
                  label="Promotions"
                  value={String(promoCount)}
                  sub={promoCount > 0 ? "detected in competitor photos" : "none detected yet"}
                  data-tip="Photos flagged as promotional content"
                  data-tipv={`${promoCount} promo${promoCount === 1 ? "" : "s"}`}
                />
                <TkWidget
                  tone="gold"
                  label="Pro quality"
                  value={`${proRatio}%`}
                  sub={`${professionalCount} of ${totalPhotos} shot professionally`}
                  data-tip="Share of photos with professional lighting"
                  data-tipv={`${proRatio}% pro lighting`}
                />
              </TkWidgetGrid>
            </RevealOnView>

            {/* ── Intel panels ── */}
            <RevealOnView>
              <TkSectionHead
                title="What the photos tell us"
                sub="Mix · quality · promotions · recent changes"
              />
              <PhotoIntel
                insights={photoInsights}
                categoryDistributions={categoryDistributions}
                qualityBenchmarks={qualityBenchmarks}
                promoActivity={promoActivity}
              />
            </RevealOnView>

            {/* ── Gallery ── */}
            <RevealOnView>
              <TkSectionHead title="The gallery" sub="Filter, or browse by competitor" />
              <TkSoftPanel style={{ padding: 18 }}>
                <PhotoGrid photos={photos} />
              </TkSoftPanel>
            </RevealOnView>
          </>
        ) : selectedLocationId ? (
          /* ── First-run / still-learning ── */
          <RevealOnView>
            <TkStillLearning
              days={1}
              target={7}
              title="No photos analyzed yet"
              description="Run a scan and we'll fetch your competitors' photos and read each one with vision AI — what they shoot, how well, and any promotions. Findings surface here and in your brief."
            />
          </RevealOnView>
        ) : (
          /* ── No location at all ── */
          <RevealOnView>
            <TkEmptyState
              icon={CAMERA_ICON}
              title="Add a location to start"
              description="Once a location is set up, we begin reading your competitors' photos and surface what changes."
            />
          </RevealOnView>
        )}
      </div>
    </div>
  )
}
