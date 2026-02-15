import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { refreshContentAction } from "./actions"
import { getScreenshotUrl } from "@/lib/content/storage"
import LocationFilter from "@/components/ui/location-filter"
import RefreshOverlay from "@/components/ui/refresh-overlay"
import MenuViewer from "@/components/content/menu-viewer"
import MenuCompare from "@/components/content/menu-compare"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import type { MenuSnapshot, SiteContentSnapshot } from "@/lib/content/types"

type PageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
    success?: string
  }>
}

// ---------------------------------------------------------------------------
// Feature badge component
// ---------------------------------------------------------------------------

function FeatureBadge({
  label,
  active,
}: {
  label: string
  active: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? "bg-green-100 text-green-700"
          : "bg-slate-100 text-slate-400"
      }`}
    >
      {active ? (
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {label}
    </span>
  )
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
  const selectedLocationId = resolvedParams?.location_id ?? locations?.[0]?.id ?? null
  const error = resolvedParams?.error
  const success = resolvedParams?.success
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId) ?? null

  // Fetch content snapshots
  let siteContentSnap: SiteContentSnapshot | null = null
  let menuSnap: MenuSnapshot | null = null
  let screenshotUrl: string | null = null
  let menuScreenshotUrl: string | null = null

  if (selectedLocationId) {
    const { data: siteSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", selectedLocationId)
      .eq("provider", "firecrawl_site_content")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (siteSnap) {
      siteContentSnap = siteSnap.raw_data as SiteContentSnapshot
      if (siteContentSnap?.screenshot?.storagePath) {
        screenshotUrl = await getScreenshotUrl(siteContentSnap.screenshot.storagePath)
      }
    }

    const { data: menuSnapRow } = await supabase
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", selectedLocationId)
      .eq("provider", "firecrawl_menu")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (menuSnapRow) {
      menuSnap = menuSnapRow.raw_data as MenuSnapshot
      if (menuSnap?.screenshot?.storagePath) {
        menuScreenshotUrl = await getScreenshotUrl(menuSnap.screenshot.storagePath)
      }
    }
  }

  // Fetch competitor menu snapshots
  type CompetitorMenuDisplay = {
    competitorName: string
    categories: MenuSnapshot["categories"]
    avgPrice: number | null
    itemCount: number
  }
  const competitorMenus: CompetitorMenuDisplay[] = []

  if (selectedLocationId) {
    const { data: competitors } = await supabase
      .from("competitors")
      .select("id, name, metadata, is_active")
      .eq("location_id", selectedLocationId)
      .eq("is_active", true)

    const approved = (competitors ?? []).filter(
      (c) => (c.metadata as Record<string, unknown>)?.status === "approved"
    )

    for (const comp of approved) {
      const { data: compMenuSnap } = await supabase
        .from("snapshots")
        .select("raw_data")
        .eq("competitor_id", comp.id)
        .eq("snapshot_type", "web_menu_weekly")
        .order("date_key", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (compMenuSnap) {
        const compMenu = compMenuSnap.raw_data as MenuSnapshot
        const prices: number[] = []
        for (const cat of compMenu.categories ?? []) {
          for (const item of cat.items ?? []) {
            if (item.priceValue != null && item.priceValue > 0) {
              prices.push(item.priceValue)
            }
          }
        }
        competitorMenus.push({
          competitorName: comp.name ?? "Competitor",
          categories: compMenu.categories ?? [],
          avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
          itemCount: (compMenu.categories ?? []).reduce(
            (s, c) => s + (c.items?.length ?? 0),
            0
          ),
        })
      }
    }
  }

  // Build quick facts for overlay
  const contentQuickFacts: string[] = []
  if (menuSnap && menuSnap.parseMeta.itemsTotal > 0) {
    contentQuickFacts.push(`Your menu has ${menuSnap.parseMeta.itemsTotal} items across ${menuSnap.categories.length} categories.`)
  }
  if (siteContentSnap?.detected?.reservation) {
    contentQuickFacts.push("Your website offers online reservations.")
  }
  if (competitorMenus.length > 0) {
    contentQuickFacts.push(`You have ${competitorMenus.length} competitor menu(s) available for comparison.`)
  }

  const geminiContext = selectedLocation
    ? `Restaurant: ${selectedLocation.name}. Website: ${selectedLocation.website ?? "unknown"}. ${menuSnap ? `Menu has ${menuSnap.parseMeta.itemsTotal} items.` : "No menu data yet."}`
    : ""

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
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="bg-gradient-to-r from-teal-50 via-white to-cyan-50">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <CardTitle>Content &amp; Menu</CardTitle>
                <CardDescription>
                  Scrape your website and competitors for menu data, pricing, and site features.
                </CardDescription>
              </div>
              {locations && locations.length > 0 && selectedLocationId && (
                <LocationFilter
                  locations={locations.map((l) => ({ id: l.id, name: l.name }))}
                  selectedLocationId={selectedLocationId}
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              {lastRefreshDate && (
                <span className="text-xs text-slate-500">
                  Last refresh: {lastRefreshDate}
                </span>
              )}
              <form action={refreshContentAction}>
                <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
                <RefreshOverlay
                  label="Refresh Content"
                  pendingLabel="Scraping website content"
                  quickFacts={contentQuickFacts}
                  geminiContext={geminiContext}
                  steps={[
                    "Mapping website pages...",
                    "Scraping homepage...",
                    "Capturing screenshots...",
                    "Finding menu page...",
                    "Extracting menu items...",
                    "Parsing prices and categories...",
                    "Scraping competitor menus...",
                    "Generating insights...",
                    "Almost done...",
                  ]}
                />
              </form>
            </div>
          </div>
        </CardHeader>
        {selectedLocation?.website && (
          <div className="border-t border-slate-100 px-6 py-2 text-xs text-slate-500 flex items-center gap-2">
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
            </svg>
            <span>
              Tracking:{" "}
              <span className="font-medium text-slate-700">{selectedLocation.website}</span>
            </span>
            <a href="/locations" className="ml-auto text-indigo-600 hover:text-indigo-700 font-medium">
              Change URL
            </a>
          </div>
        )}
      </Card>

      {/* Error / Success banners */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error.replace(/\+/g, " "))}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {decodeURIComponent(success.replace(/\+/g, " "))}
        </div>
      )}

      {/* Empty state */}
      {!siteContentSnap && !menuSnap && (
        <Card className="py-12 text-center">
          <div className="mx-auto max-w-sm space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-100">
              <svg className="h-7 w-7 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-900">No content scraped yet</p>
            <p className="text-xs text-slate-500">
              Click &quot;Refresh Content&quot; to scrape your website for menu items, pricing, screenshots, and site feature detection.
            </p>
          </div>
        </Card>
      )}

      {/* Hero Screenshot */}
      {screenshotUrl && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshotUrl}
              alt={`Screenshot of ${selectedLocation?.name ?? "website"}`}
              className="w-full object-cover"
              style={{ maxHeight: "400px" }}
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-5">
              <h2 className="text-lg font-bold text-white">
                {selectedLocation?.name}
              </h2>
              {selectedLocation?.website && (
                <a
                  href={selectedLocation.website.startsWith("http") ? selectedLocation.website : `https://${selectedLocation.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-white/80 underline hover:text-white"
                >
                  {selectedLocation.website}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Site Features */}
      {siteContentSnap && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Website Features Detected</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap gap-2 px-6 pb-5">
            <FeatureBadge label="Online Reservations" active={siteContentSnap.detected.reservation} />
            <FeatureBadge label="Online Ordering" active={siteContentSnap.detected.onlineOrdering} />
            <FeatureBadge label="Private Dining" active={siteContentSnap.detected.privateDining} />
            <FeatureBadge label="Catering" active={siteContentSnap.detected.catering} />
            <FeatureBadge label="Happy Hour" active={siteContentSnap.detected.happyHour} />
            {siteContentSnap.detected.deliveryPlatforms.length > 0 && (
              <FeatureBadge
                label={`Delivery: ${siteContentSnap.detected.deliveryPlatforms.join(", ")}`}
                active
              />
            )}
            {siteContentSnap.detected.deliveryPlatforms.length === 0 && (
              <FeatureBadge label="Delivery Platforms" active={false} />
            )}
          </div>
        </Card>
      )}

      {/* Menu Viewer + Menu Screenshot */}
      {menuSnap && menuSnap.categories.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <MenuViewer
              categories={menuSnap.categories}
              currency={menuSnap.currency}
              itemsTotal={menuSnap.parseMeta.itemsTotal}
              confidence={menuSnap.parseMeta.confidence}
            />
          </div>
          <div className="space-y-4">
            {menuScreenshotUrl && (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={menuScreenshotUrl}
                  alt="Menu page screenshot"
                  className="w-full object-cover"
                  style={{ maxHeight: "300px" }}
                />
                <div className="bg-slate-50 px-3 py-2">
                  <p className="text-[10px] text-slate-500">Menu page screenshot</p>
                </div>
              </div>
            )}
            {menuSnap.parseMeta.notes.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Parse Notes
                </p>
                {menuSnap.parseMeta.notes.map((note, i) => (
                  <p key={i} className="mt-1 text-xs text-slate-600">{note}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Menu says no items */}
      {menuSnap && menuSnap.categories.length === 0 && (
        <Card className="py-8 text-center">
          <p className="text-sm text-slate-500">No menu items could be extracted from the website.</p>
          {menuSnap.parseMeta.notes.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">{menuSnap.parseMeta.notes.join(". ")}</p>
          )}
        </Card>
      )}

      {/* Competitor Menu Compare */}
      {menuSnap && menuSnap.categories.length > 0 && competitorMenus.length > 0 && (
        <MenuCompare
          locationName={selectedLocation?.name ?? "Your Location"}
          locationCategories={menuSnap.categories}
          locationAvgPrice={locAvgPrice}
          competitors={competitorMenus}
        />
      )}
    </div>
  )
}
