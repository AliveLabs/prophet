import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { ignoreCompetitorAction } from "../actions"
import { fetchCurrentConditions } from "@/lib/weather/google"
import { Button } from "@/components/ui/button"
import MiniMap from "@/components/places/mini-map"
import SignalTimeline from "@/components/competitors/signal-timeline"
import SignalBreakdown from "@/components/competitors/signal-breakdown"
import RatingTrend from "@/components/competitors/rating-trend"
import { IntelBrief, IntelBriefSkeleton } from "@/components/competitors/intel-brief"

const formatPriceLevel = (value: string | null | undefined) => {
  if (!value) return null
  if (/^\d+$/.test(value)) {
    const count = Number(value)
    return count > 0 ? "$".repeat(Math.min(count, 4)) : null
  }
  const normalized = value.replace("PRICE_LEVEL_", "").toLowerCase()
  if (!normalized) return null
  if (normalized === "free") return "Free"
  const word = normalized.replace(/_/g, " ")
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const formatType = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

function computeFreshness(dateKey: string | null): string {
  if (!dateKey) return "No signals yet"
  const d = new Date(dateKey + "T00:00:00")
  const now = new Date()
  const diffHours = Math.floor((now.getTime() - d.getTime()) / 3600000)
  if (diffHours < 1) return "Signal < 1h ago"
  if (diffHours < 24) return `Signal ${diffHours}h ago`
  return `Signal ${Math.floor(diffHours / 24)}d ago`
}

const CATEGORY_EMOJI: Record<string, string> = {
  restaurant: "🍽️",
  cafe: "☕",
  bar: "🍸",
  bakery: "🧁",
  pizza: "🍕",
  burger: "🍔",
  sushi: "🍣",
  mexican: "🌮",
  italian: "🍝",
  chinese: "🥡",
  indian: "🍛",
  thai: "🍜",
  default: "🏪",
}

function getCategoryEmoji(category: string | null): string {
  if (!category) return CATEGORY_EMOJI.default
  const lower = category.toLowerCase()
  for (const [key, emoji] of Object.entries(CATEGORY_EMOJI)) {
    if (lower.includes(key)) return emoji
  }
  return CATEGORY_EMOJI.default
}

type DetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function CompetitorDetailPage({ params }: DetailPageProps) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  // Verify user org
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/home")

  // Fetch competitor with org verification
  const { data: competitor } = await supabase
    .from("competitors")
    .select("id, name, category, metadata, location_id, address, phone, website, is_active, locations(organization_id)")
    .eq("id", id)
    .single()

  if (!competitor) notFound()

  const locationRecord = Array.isArray(competitor.locations)
    ? competitor.locations[0]
    : competitor.locations
  const compOrgId = (locationRecord as { organization_id?: string } | null)?.organization_id
  if (compOrgId !== organizationId) notFound()

  const meta = competitor.metadata as Record<string, unknown> | null
  const placeDetails = (meta?.placeDetails as Record<string, unknown> | null) ?? null
  const rating = meta?.rating as number | null
  const reviewCount = meta?.reviewCount as number | null
  const distanceMeters = meta?.distanceMeters as number | null
  const latitude = meta?.latitude as number | null
  const longitude = meta?.longitude as number | null
  const address = (meta?.address as string | null) ?? competitor.address ?? null
  const phone = (meta?.phone as string | null) ?? competitor.phone ?? null
  const website = (meta?.website as string | null) ?? competitor.website ?? null
  const priceLevel = formatPriceLevel(placeDetails?.priceLevel as string | null)
  const businessStatus = placeDetails?.businessStatus as string | null
  const openNow = placeDetails?.currentOpeningHours
    ? (placeDetails.currentOpeningHours as { openNow?: boolean | null })?.openNow ?? null
    : null
  const mapsUri = placeDetails?.mapsUri as string | null
  const placeId = placeDetails?.placeId as string | null

  const isApproved = (meta?.status === "approved") || competitor.is_active

  // Fetch insights for this competitor (last 90 days, up to 50)
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const { data: insights } = await supabase
    .from("insights")
    .select("id, insight_type, title, summary, severity, confidence, date_key, evidence, recommendations")
    .eq("competitor_id", id)
    .gte("date_key", ninetyDaysAgo.toISOString().slice(0, 10))
    .neq("status", "dismissed")
    .order("date_key", { ascending: false })
    .limit(50)

  const insightRows = (insights ?? []) as Array<{
    id: string; insight_type: string; title: string; summary: string
    severity: string; confidence: string; date_key: string | null
    evidence: unknown; recommendations: unknown
  }>

  // Fetch rating history from snapshots
  const { data: snapshots } = await supabase
    .from("snapshots")
    .select("date_key, raw_data")
    .eq("competitor_id", id)
    .eq("snapshot_type", "listing_daily")
    .order("date_key", { ascending: true })
    .limit(60)

  const ratingPoints = (snapshots ?? [])
    .map((s) => {
      const raw = s.raw_data as Record<string, unknown> | null
      const r = raw?.rating as number | undefined
      return r != null ? { dateKey: s.date_key, rating: r } : null
    })
    .filter((p): p is { dateKey: string; rating: number } => p !== null)

  // Fetch weather
  let weather = null
  if (typeof latitude === "number" && typeof longitude === "number") {
    weather = await fetchCurrentConditions({ lat: latitude, lng: longitude })
  }

  // Last signal time
  const lastSignalDate = insightRows[0]?.date_key ?? null
  const freshnessLabel = computeFreshness(lastSignalDate)

  const distLabel = typeof distanceMeters === "number"
    ? `${(distanceMeters / 1609.34).toFixed(1)} mi`
    : null

  const currentMonth = new Date().toLocaleDateString("en-US", { month: "long" })

  return (
    <div className="mx-auto max-w-[600px]">
      {/* Back link + Watch toggle */}
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/competitors"
          className="flex items-center gap-2 text-sm font-medium text-vatic-indigo-soft transition-opacity hover:opacity-75"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 3L5 8L10 13"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Competitors
        </Link>

        {isApproved ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-primary bg-primary/15 px-3.5 py-1.5 text-[13px] font-medium text-vatic-indigo-soft">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <ellipse cx="7" cy="7" rx="5.5" ry="3.5" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="7" cy="7" r="1.8" fill="currentColor" />
              </svg>
              Watching
            </span>
            <form action={ignoreCompetitorAction}>
              <input type="hidden" name="competitor_id" value={competitor.id} />
              <Button type="submit" variant="ghost" size="sm" className="text-xs text-muted-foreground">
                Unwatch
              </Button>
            </form>
          </div>
        ) : (
          <span className="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground">
            Not tracked
          </span>
        )}
      </div>

      {/* Hero */}
      <section className="mb-6 flex items-start gap-4 border-b border-border pb-6">
        <div className="flex h-[60px] w-[60px] min-w-[60px] items-center justify-center rounded-[14px] border border-border bg-card text-[28px]">
          {getCategoryEmoji(competitor.category)}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] font-semibold leading-[1.1] text-foreground">
            {competitor.name ?? "Unknown Competitor"}
          </h1>

          <div className="mb-2 mt-1.5 flex flex-wrap items-center gap-[5px] text-[13px] text-muted-foreground">
            {typeof rating === "number" && (
              <span className="flex items-center gap-1 font-medium text-foreground">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="var(--signal-gold)" aria-hidden="true">
                  <path d="M6 1l1.35 2.73 3.01.44-2.18 2.12.51 3-2.69-1.42L3.31 9.29l.51-3L1.64 4.17l3.01-.44L6 1Z" />
                </svg>
                {rating}
                {typeof reviewCount === "number" && (
                  <span className="font-normal text-deep-violet">({reviewCount})</span>
                )}
              </span>
            )}
            {typeof rating === "number" && competitor.category && (
              <span className="text-deep-violet" aria-hidden="true">·</span>
            )}
            {competitor.category && <span>{competitor.category}</span>}
            {distLabel && (
              <>
                <span className="text-deep-violet" aria-hidden="true">·</span>
                <span>{distLabel}</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {priceLevel && (
              <span className="rounded-md border border-border bg-secondary/40 px-2.5 py-[3px] text-xs text-muted-foreground">
                {priceLevel}
              </span>
            )}
            {typeof openNow === "boolean" && (
              <span
                className={`rounded-md border px-2.5 py-[3px] text-xs ${
                  openNow
                    ? "border-precision-teal/22 bg-precision-teal/8 text-precision-teal"
                    : "border-destructive/22 bg-destructive/8 text-destructive"
                }`}
              >
                {openNow ? "Open now" : "Closed"}
              </span>
            )}
            {lastSignalDate && (
              <span className="flex items-center gap-[5px] text-xs text-deep-violet">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-precision-teal animate-pulse"
                  aria-hidden="true"
                  style={{ boxShadow: "0 0 0 3px rgba(0,191,166,0.18)" }}
                />
                {freshnessLabel}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Intelligence card (Suspense) */}
      {insightRows.length > 0 && (
        <Suspense fallback={<IntelBriefSkeleton />}>
          <IntelBrief
            competitorName={competitor.name ?? "Competitor"}
            insights={insightRows.slice(0, 15).map((i) => ({
              title: i.title,
              summary: i.summary,
              severity: i.severity,
              insight_type: i.insight_type,
              date_key: i.date_key,
            }))}
          />
        </Suspense>
      )}

      {/* Signal timeline */}
      {insightRows.length > 0 && (
        <SignalTimeline
          signals={insightRows.map((i) => ({
            id: i.id,
            insight_type: i.insight_type,
            title: i.title,
            summary: i.summary,
            severity: i.severity,
            date_key: i.date_key,
          }))}
        />
      )}

      {/* Signal breakdown */}
      {insightRows.length > 0 && (
        <SignalBreakdown
          insights={insightRows}
          month={currentMonth}
        />
      )}

      {/* Rating trend */}
      <RatingTrend
        dataPoints={ratingPoints}
        currentRating={rating}
      />

      {/* Business info */}
      <section className="mb-6">
        <h2 className="mb-4 font-display text-[22px] font-semibold text-foreground">
          Business info
        </h2>
        <div className="space-y-4">
          {/* Map */}
          {(typeof latitude === "number" && typeof longitude === "number") && (
            <div className="overflow-hidden rounded-[14px] border border-border">
              <MiniMap
                lat={latitude}
                lng={longitude}
                title={competitor.name ?? "Map"}
                className="w-full"
                mapsUri={mapsUri}
                placeId={placeId}
                address={address}
              />
            </div>
          )}

          {/* Weather */}
          {weather && (
            <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
              {weather.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={weather.iconUrl} alt={weather.condition ?? "Weather"} className="h-10 w-10" />
              ) : null}
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {typeof weather.temperature === "number"
                    ? `${Math.round(weather.temperature)}${weather.tempUnit === "FAHRENHEIT" ? "°F" : "°C"}`
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground">{weather.condition ?? "Conditions unavailable"}</p>
              </div>
            </div>
          )}

          {/* Contact details */}
          <div className="grid gap-3 sm:grid-cols-2">
            {address && (
              <div className="flex items-start gap-2 rounded-[14px] border border-border bg-card px-4 py-3">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <p className="text-sm text-muted-foreground">{address}</p>
              </div>
            )}
            {phone && (
              <a
                href={`tel:${phone}`}
                className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary/30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-vatic-indigo-soft" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5 12.8 12.8 0 0 0 2.8.7A2 2 0 0 1 22 16.9Z" />
                </svg>
                <span className="text-sm font-medium text-vatic-indigo-soft">{phone}</span>
              </a>
            )}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary/30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
                </svg>
                <span className="text-sm font-medium text-primary">Visit website</span>
              </a>
            )}
            {mapsUri && (
              <a
                href={mapsUri}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary/30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-precision-teal" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <span className="text-sm font-medium text-precision-teal">Google Maps</span>
              </a>
            )}
          </div>

          {/* Place details */}
          {placeDetails && Object.keys(placeDetails).length > 0 && (
            <div className="rounded-[14px] border border-border bg-card px-4 py-3">
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">
                  Google Places highlights
                </summary>
                <div className="mt-3 space-y-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap gap-2">
                    {businessStatus && <span className="rounded-full bg-secondary px-2 py-0.5">{formatType(businessStatus)}</span>}
                    {priceLevel && <span className="rounded-full bg-signal-gold/10 px-2 py-0.5 text-signal-gold">{priceLevel}</span>}
                    {(placeDetails.types as string[] | null)?.filter(Boolean).slice(0, 4).map((type) => (
                      <span key={type} className="rounded-full bg-secondary px-2 py-0.5">{formatType(type)}</span>
                    ))}
                  </div>
                  {typeof placeDetails.editorialSummary === "string" && (
                    <p className="rounded-lg bg-secondary px-3 py-2 text-foreground">
                      {placeDetails.editorialSummary}
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </section>

      {/* Empty state */}
      {insightRows.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-[18px] border border-border bg-card py-12 text-center">
          <span className="text-4xl opacity-40">📡</span>
          <p className="text-sm font-medium text-muted-foreground">No signals yet</p>
          <p className="text-xs text-deep-violet">
            Run a data refresh to start collecting competitor intelligence
          </p>
        </div>
      )}
    </div>
  )
}
