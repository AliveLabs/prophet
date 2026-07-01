import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getBrief } from "@/lib/insights/daily-brief"
import { ensureBriefQueued } from "@/lib/jobs/triggers"
import { loadPipelineChecks } from "../proof-data"
import { loadStandingAnswer } from "@/lib/ask/history"
import { loadPlayActions, loadWeeklyMomentum } from "@/lib/insights/momentum"
import BriefView from "./brief-view"
import { fetchPhotosPageData } from "@/lib/cache/photos"
import "./brief.css"

// Loose read for the location row — `brand_tolerance` lands with the engine-rewrite
// migration and isn't in the generated DB types yet (same pattern as the lib layer).
type LocRow = { id: string; name: string | null; brand_tolerance: number | null; primary_place_id: string | null }
type LocQuery = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => {
          limit: (n: number) => { maybeSingle: () => Promise<{ data: LocRow | null }> }
        }
      }
    }
  }
}

export default async function HomePage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  // Orgless = onboarding was never completed. Resume it instead of rendering a
  // blank page (the catch-all for any entry point that lands here without an org).
  if (!organizationId) redirect("/onboarding")

  // The org's primary location (id + name). Brand-tolerance now lives on the
  // Settings page (explicit refresh), not the brief rail.
  const { data: locRow } = await (supabase as unknown as LocQuery)
    .from("locations")
    .select("id, name, brand_tolerance, primary_place_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!locRow) {
    return <FirstRunState message="Add your location to start receiving your morning brief." />
  }

  const brief = await getBrief(locRow.id)

  // Watched competitors (approved + active) for the brief's synth count line and
  // the listing-imagery Shelf comparison (ALT-160 — needs ids to pull their photos).
  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", locRow.id)
    .eq("is_active", true)
  const approvedComps = (comps ?? [])
    .filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")
    .map((c) => ({ id: (c as { id: string }).id, name: (c.name as string) ?? "Competitor" }))
  const competitors = approvedComps.map((c) => c.name).slice(0, 6)

  if (!brief) {
    // FAILSAFE (2026-06-12 Raising Cane's hang): a location with data but no
    // brief means the build never ran or died — heal it on sight instead of
    // stranding the user on an infinite loading state. Idempotent: skips when
    // a brief job is already queued/running or was created in the last 2h.
    const repair = await ensureBriefQueued(locRow.id, organizationId)
    const watching =
      competitors.length > 0
        ? ` ${competitors.length} competitor${competitors.length === 1 ? " is" : "s are"} already being watched — browse Competitors while you wait.`
        : ""
    return (
      <FirstRunState
        message={
          repair === "error"
            ? "Your brief hit a snag on our side. We're on it — check back soon, and your data keeps collecting in the meantime."
            : `Your brief is being built right now — it usually lands within ten minutes of this page telling you so.${watching}`
        }
      />
    )
  }

  const competitorIds = approvedComps.map((c) => c.id)
  const [checks, standingAsk, playActions, weeklyMomentum, photosData] = await Promise.all([
    loadPipelineChecks(),
    loadStandingAnswer(locRow.id),
    loadPlayActions(locRow.id, brief.dateKey),
    loadWeeklyMomentum(locRow.id),
    fetchPhotosPageData(locRow.id, competitorIds),
  ])

  // Listing-imagery modules (ALT-160): own-listing photo rows + per-competitor
  // groups for the you-vs-set Shelf. Plain serializable rows (no functions cross
  // the server→client boundary — the modules compute the audit from these).
  const ownPhotos = photosData.ownPhotos.map((p) => ({
    analysis_result: p.analysis_result,
    author_attribution: p.author_attribution,
    image_url: p.image_url,
  }))
  const compNameById = new Map(approvedComps.map((c) => [c.id, c.name]))
  const compRowsById = new Map<string, Array<{ analysis_result: unknown }>>()
  for (const p of photosData.photos) {
    const arr = compRowsById.get(p.competitor_id) ?? []
    arr.push({ analysis_result: p.analysis_result })
    compRowsById.set(p.competitor_id, arr)
  }
  const shelfCompetitors = Array.from(compRowsById.entries()).map(([id, rows]) => ({
    id,
    name: compNameById.get(id) ?? "Competitor",
    rows,
  }))

  return (
    <BriefView
      brief={brief}
      locationId={locRow.id}
      locationName={locRow.name ?? "Your location"}
      competitors={competitors}
      detailHrefBase="/home"
      checks={checks}
      standingAsk={standingAsk ? { question: standingAsk.question, answer: standingAsk.answer } : null}
      playActions={playActions}
      weeklyMomentum={weeklyMomentum}
      ownPhotos={ownPhotos}
      hasListing={!!locRow.primary_place_id}
      shelfCompetitors={shelfCompetitors}
    />
  )
}

function FirstRunState({ message }: { message: string }) {
  return (
    <div className="ticket-brief">
      <div className="state">
        <span className="state-kicker">Your Brief</span>
        <h1 className="state-head">Getting your market read.</h1>
        <p className="state-sub">{message}</p>
        <div className="sweep" />
      </div>
    </div>
  )
}
