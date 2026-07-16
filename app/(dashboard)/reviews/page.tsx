// Review Intelligence (ALT-353) — the /reviews triage surface.
// Composition mirrors insights/page.tsx exactly: pv-page head, tk-kit body,
// page-local css import; async data loading in the page component (the
// dashboard layout's Suspense boundary owns the fallback — never
// `export const dynamic`, forbidden in this repo).
//
// The page computes everything band-shaped SERVER-side (make-good is pure) and
// hands the client island only serializable card views — no raw 0-100 score
// ever crosses to the UI (bands + plain words only).

import AutoFilterForm from "@/components/filters/auto-filter-form"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { TkEmptyState, TkSoftPanel, TkTooltipLayer } from "@/components/ticket"
import { listLocationReviews, aggregateReviewerSignals } from "@/lib/reviews/store"
import {
  genuinenessBand,
  recommendMakeGood,
  GENEROSITY_DEFAULT,
} from "@/lib/reviews/make-good"
import {
  REVIEWS_COPY,
  buildReviewCardView,
  groupReviewViews,
  reviewsSubLine,
  type ReviewCardView,
} from "./reviews-map"
import ReviewsTriage from "./reviews-cards"
import "./reviews.css"

// Loose read for the location row — `generosity_threshold` lands with the
// Review Intelligence migration, ahead of the repo-wide types regen (same
// convention as home/page.tsx's brand_tolerance LocRow).
type LocRow = { id: string; name: string | null; generosity_threshold: number | null }

type ReviewsPageProps = {
  searchParams?: Promise<{
    location_id?: string
  }>
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, generosity_threshold")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
  const locations = (locationRows ?? []) as unknown as LocRow[]

  // Active location: same resolution as insights/page.tsx — the requested id
  // when it belongs to this org, else the newest location.
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const requestedLocationId = resolvedSearchParams?.location_id ?? null
  const selectedLocationId =
    requestedLocationId && locations.some((l) => l.id === requestedLocationId)
      ? requestedLocationId
      : locations[0]?.id ?? null
  const selectedLocation = locations.find((l) => l.id === selectedLocationId) ?? null

  // The make-good posture (0 respond-first .. 100 generous). NULL pre-slider →
  // the shared default, so recommendations never depend on the operator having
  // visited Settings.
  const threshold = selectedLocation?.generosity_threshold ?? GENEROSITY_DEFAULT

  // -------------------------------------------------------------------------
  // Load + score. listLocationReviews is fail-soft (pre-migration → empty
  // surface); reviewer signals + bands are pure CPU over the local corpus.
  // -------------------------------------------------------------------------

  const rows = selectedLocationId ? await listLocationReviews(supabase, selectedLocationId) : []
  const signalsByAuthor = aggregateReviewerSignals(rows)

  const views: ReviewCardView[] = rows.map((row) => {
    // "Scored" = the scoring pass has written both axes. Anything else renders
    // neutrally (never a fabricated band — the scoring pass's fail-soft contract).
    const isScored =
      row.scored_at != null && row.authenticity_score != null && row.severity_score != null
    if (!isScored) return buildReviewCardView(row, null)
    const signals = row.author_key ? signalsByAuthor.get(row.author_key) : undefined
    return buildReviewCardView(row, {
      genuineness: genuinenessBand(row, signals),
      recommendation: recommendMakeGood(row, { threshold, signals }),
    })
  })

  const groups = groupReviewViews(views)

  // Head counts: open = still needs the operator; handled this month = triaged
  // (responded/dismissed) with a triage stamp inside the current calendar month.
  const openCount = groups.attention.length + groups.secondLook.length
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const handledThisMonth = rows.filter(
    (r) =>
      r.triage_status !== "open" &&
      r.triage_updated_at != null &&
      Date.parse(r.triage_updated_at) >= monthStart.getTime(),
  ).length

  return (
    <div className="ticket-brief tk-kit">
      <TkTooltipLayer />
      <div className="pv-page">
        <div className="pv-page-head">
          <span className="pv-kicker">{REVIEWS_COPY.head.kicker}</span>
          <h1 className="pv-h1">{REVIEWS_COPY.head.h1}</h1>
          <p className="pv-sub">{reviewsSubLine(openCount, handledThisMonth)}</p>
        </div>

        <div className="rev-page">
          {/* Location switcher — only when there's a choice to make (calm page) */}
          {locations.length > 1 && (
            <TkSoftPanel className="rev-bar">
              <AutoFilterForm
                filters={[
                  {
                    name: "location_id",
                    defaultValue: selectedLocationId ?? "",
                    options: locations.map((l) => ({ value: l.id, label: l.name ?? "Location" })),
                  },
                ]}
              />
            </TkSoftPanel>
          )}

          {views.length === 0 ? (
            <TkEmptyState
              variant="muted"
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M20 11c0 3.6-3.6 6.4-8 6.4-.9 0-1.8-.1-2.6-.3L5 19.5l.9-3.2C4.2 15 3 13.1 3 11c0-3.6 3.6-6.4 8.5-6.4S20 7.4 20 11z" />
                  <path d="M11.5 8.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" />
                </svg>
              }
              title={REVIEWS_COPY.empty.title}
              description={REVIEWS_COPY.empty.description}
            />
          ) : (
            <ReviewsTriage groups={groups} />
          )}
        </div>
      </div>
    </div>
  )
}
