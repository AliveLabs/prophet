import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { getScreenshotUrl } from "@/lib/content/storage"
import LocationFilter from "@/components/ui/location-filter"
import { fetchContentPageData } from "@/lib/cache/content"
import type { MenuSnapshot, SiteContentSnapshot } from "@/lib/content/types"
import ContentBoard, { type CompetitorMenuDisplay } from "./content-board"
import "./content.css"
import { TkRule } from "@/components/ticket"

type PageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
    success?: string
  }>
}

export default async function ContentPage({ searchParams }: PageProps) {
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
    .select("id, name, website")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedParams = await Promise.resolve(searchParams)
  const requestedLocationId = resolvedParams?.location_id ?? null
  const selectedLocationId = (requestedLocationId && locations?.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locations?.[0]?.id ?? null
  const error = resolvedParams?.error
  const success = resolvedParams?.success
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId) ?? null

  // Fetch content snapshots (cached, 7-day TTL)
  const cached = selectedLocationId
    ? await fetchContentPageData(selectedLocationId)
    : { siteContentSnap: null, menuSnap: null, competitors: [], competitorMenuSnaps: [] }

  let siteContentSnap: SiteContentSnapshot | null = null
  let menuSnap: MenuSnapshot | null = null
  let screenshotUrl: string | null = null
  let menuScreenshotUrl: string | null = null

  if (cached.siteContentSnap) {
    siteContentSnap = cached.siteContentSnap.raw_data as SiteContentSnapshot
    if (siteContentSnap?.screenshot?.storagePath) {
      screenshotUrl = await getScreenshotUrl(siteContentSnap.screenshot.storagePath)
    }
  }

  if (cached.menuSnap) {
    menuSnap = cached.menuSnap.raw_data as MenuSnapshot
    if (menuSnap?.screenshot?.storagePath) {
      menuScreenshotUrl = await getScreenshotUrl(menuSnap.screenshot.storagePath)
    }
  }

  const competitorMenus: CompetitorMenuDisplay[] = []

  for (const cms of cached.competitorMenuSnaps) {
    const comp = cached.competitors.find((c) => c.id === cms.competitor_id)
    const compMenu = cms.raw_data as MenuSnapshot
    const prices: number[] = []
    for (const cat of compMenu.categories ?? []) {
      for (const item of cat.items ?? []) {
        if (item.priceValue != null && item.priceValue > 0) {
          prices.push(item.priceValue)
        }
      }
    }
    competitorMenus.push({
      competitorName: comp?.name ?? "Competitor",
      categories: compMenu.categories ?? [],
      avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
      itemCount: (compMenu.categories ?? []).reduce(
        (s, c) => s + (c.items?.length ?? 0),
        0
      ),
    })
  }

  // Compute location avg price
  const locPrices: number[] = []
  for (const cat of menuSnap?.categories ?? []) {
    for (const item of cat.items ?? []) {
      if (item.priceValue != null && item.priceValue > 0) {
        locPrices.push(item.priceValue)
      }
    }
  }
  const locAvgPrice = locPrices.length > 0
    ? locPrices.reduce((a, b) => a + b, 0) / locPrices.length
    : null

  const lastRefreshDate = siteContentSnap?.capturedAt
    ? new Date(siteContentSnap.capturedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Your storefront</span>
        <h1 className="pv-h1">Content &amp; menu</h1>
        <p className="pv-sub">
          What customers see on your site — the menu, prices, and features we read from it — lined up
          honestly against your competitors&apos; own published menus.
        </p>
      </div>
      <TkRule />

      {/* control bar — location filter + refresh, on-system */}
      <div className="tk-kit">
        <div className="content-controls">
          {locations && locations.length > 0 && selectedLocationId && (
            <LocationFilter
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              selectedLocationId={selectedLocationId}
            />
          )}
          {lastRefreshDate && (
            <span className="content-refreshed">
              <span className="content-dot" aria-hidden="true" />
              Read {lastRefreshDate}
            </span>
          )}
        </div>

        {error && (
          <div className="content-banner content-banner-err" role="alert">
            {decodeURIComponent(error.replace(/\+/g, " "))}
          </div>
        )}
        {success && (
          <div className="content-banner content-banner-ok" role="status">
            {decodeURIComponent(success.replace(/\+/g, " "))}
          </div>
        )}
      </div>

      <ContentBoard
        locationName={selectedLocation?.name ?? "Your location"}
        website={selectedLocation?.website ?? null}
        screenshotUrl={screenshotUrl}
        menuScreenshotUrl={menuScreenshotUrl}
        siteContent={siteContentSnap}
        menu={menuSnap}
        locAvgPrice={locAvgPrice}
        competitorMenus={competitorMenus}
      />
    </div>
  )
}
