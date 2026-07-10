"use client"

// Authed onboarding — "The Pass" rebuild. STRUCTURE rebuild of the old
// centered-column wizard into the Dribbble pearlescent SPLIT layout: a
// canvas rail (brand mark + big display heading + vertical stepper + a
// floating accent card) beside a floating soft-shadow panel that carries
// the step form. All DATA WIRING is unchanged — same five steps wired to
// the same server actions (find restaurant → confirm details creates the
// org + location & kicks competitor discovery → confirm competitors →
// optional monitoring prefs → processing polls the real job queue).

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import "./onboarding.css"
import {
  createOrgAndLocationAction,
  createLocationForOrgAction,
  discoverCompetitorsForLocation,
  addCompetitorCandidateAction,
  completeOnboardingAction,
} from "./actions"
import { getVerticalConfig } from "@/lib/verticals"
import type { VerticalConfig } from "@/lib/verticals"

const TOTAL = 5
const MAX_TRACKED = 5

type Prediction = { place_id: string; description: string }

// Shape of /api/places/details → place (mapPlaceToLocation output).
type Place = {
  primary_place_id: string
  name: string
  category: string | null
  types: string[]
  address_line1: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  geo_lat: number | null
  geo_lng: number | null
  phone: string | null
  website: string | null
}

export type OnboardingCandidate = {
  id: string
  name: string | null
  category: string | null
  address: string | null
  provider_entity_id: string | null
  metadata: Record<string, unknown>
  relevance_score: number | null
}

type WizardProps = {
  existingOrgId?: string | null
  existingLocationId?: string | null
  existingCompetitors?: OnboardingCandidate[]
  /** Coordinates of the existing location (resume/setup) — bias the step-2
   *  competitor search to the neighborhood. Fresh signups get coords from the
   *  step-0 place pick instead. */
  existingLocationGeo?: { lat: number; lng: number } | null
  verticalConfig?: VerticalConfig
  /**
   * "signup" (default) = a new customer creating their account (ends at the
   * Stripe trial step). "setup" = an admin completing an existing demo/test org
   * through the same wizard: attaches to the existing org, skips billing, lands
   * in the org's dashboard.
   */
  mode?: "signup" | "setup"
  setupOrgName?: string | null
}

const PREFS: Array<{ key: string; title: string; sub: string }> = [
  { key: "pricing_changes", title: "Pricing changes", sub: "When competitors move their prices." },
  { key: "menu_updates", title: "Menu updates", sub: "New dishes and menu changes nearby." },
  { key: "promotions", title: "Promotions", sub: "Deals and specials competitors run." },
  { key: "review_activity", title: "Review activity", sub: "Review spikes and sentiment shifts." },
  { key: "new_openings", title: "New openings", sub: "New spots opening in your area." },
]

// Rail copy per step — the big-headline narrative on the pearlescent canvas.
const RAIL: Array<{ kicker: string; head: ReactNode; sub: string }> = [
  {
    kicker: "Welcome to Ticket",
    head: <>Let&apos;s find <em>your restaurant.</em></>,
    sub: "Search for your place and we'll pull everything we can from your public listing — so you barely have to type.",
  },
  {
    kicker: "Mostly done for you",
    head: <>Does this <em>look right?</em></>,
    sub: "We pulled these details straight from your listing. Fix anything that's off, then keep going.",
  },
  {
    kicker: "Found for you",
    head: <>Here&apos;s who <em>we'd watch.</em></>,
    sub: "We scanned your neighborhood for similar spots and picked the closest competitors — each with the reason why.",
  },
  {
    kicker: "Optional",
    head: <>Anything you&apos;re <em>focused on?</em></>,
    sub: "We watch all of this by default. Switch off anything you don't care about — you can change it anytime in Settings.",
  },
  {
    kicker: "You're set",
    head: <>Building your <em>first brief.</em></>,
    sub: "We're pulling competitor, demand, and review signals now. Watch each one land — or close the tab and we'll email you.",
  },
]

const STEP_NAMES = ["Find", "Confirm", "Competitors", "Focus", "Build"] as const

function prettyCategory(category: string | null | undefined): string {
  if (!category) return ""
  const s = category.replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatMiles(meters: number): string {
  return Math.max(0.1, meters * 0.000621371).toFixed(1)
}

function metaLine(c: OnboardingCandidate): string {
  const parts: string[] = []
  if (c.category) parts.push(prettyCategory(c.category))
  const dist = num(c.metadata.distanceMeters)
  if (dist !== null) parts.push(`${formatMiles(dist)} mi`)
  const rating = num(c.metadata.rating)
  if (rating !== null) parts.push(`${rating.toFixed(1)}★`)
  return parts.join(" · ")
}

// Human "why we picked it". The ranker writes one plain sentence per pick
// (metadata.why); the deterministic line below is the fallback when it didn't.
function whyLine(c: OnboardingCandidate): string {
  const written = typeof c.metadata.why === "string" ? c.metadata.why.trim() : ""
  if (written) return written
  const factors = Array.isArray(c.metadata.factors)
    ? (c.metadata.factors as Array<{ label?: string; value?: number }>)
    : []
  // "Same cuisine" only when the categories GENUINELY match (both specific) —
  // the old substring check called steakhouses "Same cuisine" as a bakery.
  const sameCuisine = factors.some(
    (f) => f.label === "category_match" && (f.value ?? 0) >= 1
  )
  const dist = num(c.metadata.distanceMeters)
  const rating = num(c.metadata.rating)
  const parts: string[] = [
    sameCuisine ? "Same cuisine" : c.category ? prettyCategory(c.category) : "Nearby spot",
  ]
  if (dist !== null) parts.push(`${formatMiles(dist)} mi away`)
  if (rating !== null && rating >= 4.3) parts.push(`strong ${rating.toFixed(1)}★ reputation`)
  return parts.join(", ")
}

const PIPELINE_ORDER = [
  "content",
  "visibility",
  "events",
  "weather",
  "busy_times",
  "social",
  "photos",
  "insights",
  "brief",
] as const

const PIPELINE_LABELS: Record<string, string> = {
  content: "Menus & websites",
  visibility: "Search visibility",
  events: "Local events",
  weather: "Weather",
  busy_times: "Foot traffic",
  social: "Social media",
  photos: "Photos",
  insights: "First signals",
  brief: "Your first brief",
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/* ── tiny inline icon set (no external deps; AA-safe via currentColor) ── */
const IconArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const IconSpark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
)
const IconInfo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
  </svg>
)
const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
)
const IconBrandT = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 6h14M12 6v12" />
  </svg>
)

// Step 4 — runs completion once, then shows real signal_jobs statuses.
// (Logic preserved verbatim from the original wizard; presentation only.)
function ProcessingStep({
  orgId,
  locationId,
  competitorIds,
  monitoringPrefs,
  setupMode,
}: {
  orgId: string
  locationId: string
  competitorIds: string[]
  monitoringPrefs: Record<string, boolean>
  setupMode: boolean
}) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Array<{ pipeline: string; status: string }> | null>(null)
  const [completionDone, setCompletionDone] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedRef = useRef(false)
  const mountedAtRef = useRef(Date.now())

  const runCompletion = useCallback(async () => {
    setCompletionError(null)
    try {
      const result = await completeOnboardingAction({
        orgId,
        locationId,
        competitorIds,
        monitoringPrefs,
      })
      if (!result.ok) setCompletionError(result.error)
    } catch {
      setCompletionError("Something went wrong finishing setup. Try again.")
    } finally {
      setCompletionDone(true)
    }
  }, [orgId, locationId, competitorIds, monitoringPrefs])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void runCompletion()
  }, [runCompletion])

  // Poll the authed progress route every ~4s for real job statuses. Stops
  // after 2h: an abandoned tab must not poll forever (a 16h zombie tab was
  // observed in the wild, 2026-06-12) — the email path covers them by then.
  useEffect(() => {
    let cancelled = false
    const pollUntil = Date.now() + 2 * 60 * 60 * 1000
    // eslint-disable-next-line prefer-const -- timer is referenced in poll() before assignment; const would cause a TDZ/use-before-define error
    let timer: ReturnType<typeof setInterval> | undefined
    async function poll() {
      if (Date.now() > pollUntil) {
        if (timer) clearInterval(timer)
        return
      }
      try {
        const res = await fetch(
          `/api/onboarding/progress?location_id=${encodeURIComponent(locationId)}`
        )
        const data = await res.json()
        if (!cancelled && data.ok && Array.isArray(data.jobs)) setJobs(data.jobs)
      } catch {
        // transient — next tick retries
      }
    }
    void poll()
    timer = setInterval(poll, 4000)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [locationId])

  // Don't hold people hostage: after ~90s they can enter even if jobs run on.
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 90_000)
    return () => clearTimeout(timer)
  }, [])

  // Elapsed clock — honest expectations beat a spinner on a loop.
  useEffect(() => {
    const timer = setInterval(() => setElapsedMs(Date.now() - mountedAtRef.current), 1000)
    return () => clearInterval(timer)
  }, [])

  const statusByPipeline = new Map((jobs ?? []).map((j) => [j.pipeline, j.status]))
  const insightsDone = statusByPipeline.get("insights") === "done"
  const allDone =
    jobs !== null && jobs.length > 0 && jobs.every((j) => j.status === "done")
  const canEnter = completionDone && !completionError && (insightsDone || timedOut)

  return (
    <>
      <span className="ob-panel-eyebrow">{setupMode ? "Demo setup" : "Almost there"}</span>
      <h2 className="ob-panel-title">We&apos;re building your first brief.</h2>
      <p className="ob-panel-lede">
        Each row below is live status from the pipeline. Most signals land in
        5–15 minutes; the full first brief can take 30–60 minutes for a busy
        market.
      </p>
      <p className="ob-hint">
        Elapsed: <span className="tk-mono">{formatElapsed(elapsedMs)}</span> · You
        can close this tab — we&apos;ll email you the moment your first brief is ready.
      </p>

      {completionError ? (
        <>
          <div className="ob-alert"><IconAlert />{completionError}</div>
          <div className="ob-nav">
            <button className="ob-btn ob-btn--act" onClick={() => { setCompletionDone(false); void runCompletion() }}>
              Try again
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="ob-status">
            {PIPELINE_ORDER.map((pipeline) => {
              const status = statusByPipeline.get(pipeline) ?? "queued"
              const cls =
                status === "done"
                  ? "is-ready"
                  : status === "running"
                    ? "is-doing"
                    : status === "failed"
                      ? "is-failed"
                      : "is-queued"
              const when =
                status === "done"
                  ? "Ready"
                  : status === "running"
                    ? "In progress"
                    : status === "failed"
                      ? "Hit a snag"
                      : jobs === null || jobs.length === 0
                        ? "Starting"
                        : "Queued"
              return (
                <li className={`ob-status__row ${cls}`} key={pipeline}>
                  <span className="ob-status__mark" />
                  <span className="ob-status__label">{PIPELINE_LABELS[pipeline]}</span>
                  <span className="ob-status__when">{when}</span>
                </li>
              )
            })}
          </ul>

          {!allDone ? <div className="ob-sweep" /> : null}

          {canEnter ? (
            <>
              {!allDone ? (
                <p className="ob-hint">
                  Still working — data keeps landing after you continue. Your brief
                  fills in as each signal finishes, and we&apos;ll email you when
                  it&apos;s ready.
                </p>
              ) : null}
              <div className="ob-nav">
                {/* Signup: the trial (and recurring pulls) start at checkout —
                    /onboarding/trial collects the card before the dashboard.
                    Setup (admin/demo): no billing — drop straight into the org's
                    dashboard (context already switched by completeOnboardingAction). */}
                <button
                  className="ob-btn ob-btn--act"
                  onClick={() => router.push(setupMode ? "/home" : "/onboarding/trial")}
                >
                  {setupMode ? "Open demo dashboard" : "Continue"}
                  <IconArrow />
                </button>
              </div>
            </>
          ) : (
            <p className="ob-hint">
              The essentials usually land in a few minutes. Hang tight — or close this
              tab and watch for our email.
            </p>
          )}
        </>
      )}
    </>
  )
}

export default function OnboardingWizardPass({
  existingOrgId,
  existingLocationId,
  existingCompetitors,
  existingLocationGeo,
  verticalConfig: externalConfig,
  mode = "signup",
  setupOrgName,
}: WizardProps) {
  const verticalConfig = externalConfig ?? getVerticalConfig()
  const setupMode = mode === "setup"
  const initialStep = existingOrgId && existingLocationId ? 2 : 0
  const [step, setStep] = useState(initialStep)

  // step 0 — find restaurant (authed Places autocomplete)
  const [query, setQuery] = useState("")
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [listOpen, setListOpen] = useState(false)
  const [place, setPlace] = useState<Place | null>(null)
  const [loadingPlace, setLoadingPlace] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)

  // step 1 — confirm details (only fields createOrgAndLocationAction accepts)
  const [bizName, setBizName] = useState("")
  const [address, setAddress] = useState("")
  const [cuisine, setCuisine] = useState("")
  const [website, setWebsite] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [orgId, setOrgId] = useState<string | null>(existingOrgId ?? null)
  const [locationId, setLocationId] = useState<string | null>(existingLocationId ?? null)

  // step 2 — competitors (top picks auto-selected; selection = ids sent to completion)
  const [competitors, setCompetitors] = useState<OnboardingCandidate[]>(
    existingCompetitors ?? []
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set((existingCompetitors ?? []).slice(0, MAX_TRACKED).map((c) => c.id))
  )
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  // Places typeahead for "+ Add a competitor" — same instant autocomplete as
  // step 0, biased to the location. (The old search here round-tripped through
  // LLM discovery with the typed text as the TARGET business, so it could
  // never return the place you actually typed.)
  const [compPredictions, setCompPredictions] = useState<Prediction[]>([])
  const [addingPlaceId, setAddingPlaceId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // step 3 — monitoring prefs (same booleans the actions persist)
  const [monitoringPrefs, setMonitoringPrefs] = useState<Record<string, boolean>>({
    pricing_changes: true,
    menu_updates: true,
    promotions: true,
    review_activity: true,
    new_openings: true,
  })

  // debounced autocomplete; pauses once a place is chosen
  useEffect(() => {
    const q = query.trim()
    if (place || q.length < 2) {
      setPredictions([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(q)}`)
        const data = await res.json()
        setPredictions(data.ok ? (data.predictions ?? []) : [])
        setListOpen(true)
      } catch {
        setPredictions([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, place])

  async function pick(p: Prediction) {
    setQuery(p.description)
    setListOpen(false)
    setPredictions([])
    setLoadingPlace(true)
    setPlaceError(null)
    try {
      const res = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(p.place_id)}`
      )
      const data = await res.json()
      if (!data.ok || !data.place) {
        setPlaceError("Couldn't pull that listing. Try another result.")
      } else {
        const selected = data.place as Place
        setPlace(selected)
        setBizName(selected.name ?? "")
        setAddress(selected.address_line1 ?? "")
        setCuisine(prettyCategory(selected.category))
        setWebsite(selected.website ?? "")
      }
    } catch {
      setPlaceError("Lookup failed. Try another result.")
    } finally {
      setLoadingPlace(false)
    }
  }

  function clearPlace() {
    setPlace(null)
    setQuery("")
    setPlaceError(null)
  }

  const discover = useCallback(
    async (locId: string) => {
      setDiscovering(true)
      setDiscoveryError(null)
      try {
        const result = await discoverCompetitorsForLocation(
          locId,
          verticalConfig.placesApiType
        )
        if (result.ok) {
          setCompetitors(result.competitors)
          // A re-run replaces the suggestion set (fresh DB rows, fresh ids) —
          // keep whatever the operator already selected that still exists,
          // otherwise default to the top picks.
          setSelectedIds((prev) => {
            const valid = new Set(result.competitors.map((c) => c.id))
            const kept = new Set([...prev].filter((id) => valid.has(id)))
            return kept.size > 0
              ? kept
              : new Set(result.competitors.slice(0, MAX_TRACKED).map((c) => c.id))
          })
        } else {
          setDiscoveryError(result.error)
        }
      } catch {
        setDiscoveryError("Competitor discovery failed. Try again.")
      } finally {
        setDiscovering(false)
      }
    },
    [verticalConfig.placesApiType]
  )

  // Resume at step 2 with no candidates yet → re-run discovery once. Also
  // re-run when every existing candidate predates identity-aware discovery
  // (no metadata.source) — the run replaces the legacy suggestion set.
  const resumeDiscoveryRef = useRef(false)
  useEffect(() => {
    if (resumeDiscoveryRef.current) return
    resumeDiscoveryRef.current = true
    const existing = existingCompetitors ?? []
    const legacySet = existing.length > 0 && existing.every((c) => !c.metadata.source)
    if (initialStep === 2 && existingLocationId && (existing.length === 0 || legacySet)) {
      void discover(existingLocationId)
    }
  }, [initialStep, existingLocationId, existingCompetitors, discover])

  // Creates the org + location, then kicks discovery while step 2 shows progress.
  async function handleConfirmDetails() {
    if (!place || !bizName.trim() || creating) return
    setCreating(true)
    setCreateError(null)
    const placePayload = {
      primary_place_id: place.primary_place_id,
      name: bizName.trim(),
      category: place.category,
      types: place.types,
      address_line1: address.trim() || null,
      city: place.city,
      region: place.region,
      postal_code: place.postal_code,
      country: place.country,
      geo_lat: place.geo_lat,
      geo_lng: place.geo_lng,
      website: website.trim() || null,
    }
    // Setup mode (orgId already set — e.g. completing a demo): attach the
    // location to the EXISTING org. Signup: create a fresh org + location.
    if (orgId) {
      const result = await createLocationForOrgAction({
        orgId,
        cuisine: cuisine.trim() || null,
        businessName: bizName.trim(),
        place: placePayload,
      })
      setCreating(false)
      if (!result.ok) {
        setCreateError(result.error)
        return
      }
      setLocationId(result.locationId)
      setStep(2)
      void discover(result.locationId)
      return
    }

    const result = await createOrgAndLocationAction({
      businessName: bizName.trim(),
      cuisine: cuisine.trim() || null,
      industryType: verticalConfig.industryType,
      place: placePayload,
    })
    setCreating(false)
    if (!result.ok) {
      setCreateError(result.error)
      return
    }
    setOrgId(result.orgId)
    setLocationId(result.locationId)
    setStep(2)
    void discover(result.locationId)
  }

  // Step 2 search — debounced Places autocomplete biased to the location
  // (instant, and it finds the exact place you type — chains included).
  const searchLat = place?.geo_lat ?? existingLocationGeo?.lat ?? null
  const searchLng = place?.geo_lng ?? existingLocationGeo?.lng ?? null
  useEffect(() => {
    if (!adding) return
    const q = searchQuery.trim()
    if (q.length < 2) {
      setCompPredictions([])
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const bias =
          searchLat !== null && searchLng !== null
            ? `&lat=${searchLat}&lng=${searchLng}&radius=50000`
            : ""
        const res = await fetch(
          `/api/places/autocomplete?input=${encodeURIComponent(q)}${bias}`
        )
        const data = await res.json()
        setCompPredictions(data.ok ? (data.predictions ?? []).slice(0, 5) : [])
      } catch {
        setCompPredictions([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      clearTimeout(t)
      setSearching(false)
    }
  }, [adding, searchQuery, searchLat, searchLng])

  // Pick from the typeahead → persist as a pending candidate → select it.
  async function pickCompetitor(p: Prediction) {
    if (!locationId || addingPlaceId) return
    setAddingPlaceId(p.place_id)
    setAddError(null)
    try {
      const result = await addCompetitorCandidateAction({
        locationId,
        placeId: p.place_id,
      })
      if (result.ok) {
        const added = result.competitor
        setCompetitors((existing) => {
          const byId = new Map(existing.map((c) => [c.id, c]))
          byId.set(added.id, added)
          return Array.from(byId.values())
        })
        setSelectedIds((prev) => {
          if (prev.size >= MAX_TRACKED || prev.has(added.id)) return prev
          const next = new Set(prev)
          next.add(added.id)
          return next
        })
        setSearchQuery("")
        setCompPredictions([])
      } else {
        setAddError(result.error)
      }
    } catch {
      setAddError("Couldn't add that one. Try again.")
    } finally {
      setAddingPlaceId(null)
    }
  }

  const removeCompetitor = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const addCompetitor = (id: string) =>
    setSelectedIds((prev) => {
      if (prev.size >= MAX_TRACKED) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })

  const togglePref = (key: string) =>
    setMonitoringPrefs((prev) => ({ ...prev, [key]: !prev[key] }))

  const selected = competitors.filter((c) => selectedIds.has(c.id))
  const filterQ = searchQuery.trim().toLowerCase()
  const suggestions = competitors
    .filter((c) => !selectedIds.has(c.id))
    .filter((c) => !filterQ || (c.name ?? "").toLowerCase().includes(filterQ))
    .slice(0, 6)

  const rail = RAIL[step] ?? RAIL[RAIL.length - 1]

  return (
    <div className="ob">
      <div className="ob-canvas" aria-hidden="true" />

      {/* MOBILE glass top bar */}
      <header className="ob-topbar">
        <span className="ob-brand">
          <span className="ob-mark"><IconBrandT /></span>
          <span className="ob-wordmark">Ticket</span>
        </span>
        <span className="ob-steplabel">
          {step < TOTAL - 1 ? `Step ${step + 1} of ${TOTAL - 1}` : "All set"}
        </span>
      </header>

      <div className="ob-split">
        {/* LEFT — pearlescent rail (desktop) */}
        <aside className="ob-rail">
          <div className="ob-rail-head">
            <span className="ob-brand">
              <span className="ob-mark"><IconBrandT /></span>
              <span className="ob-wordmark">Ticket</span>
            </span>
            <div>
              <span className="ob-kicker">{rail.kicker}</span>
              <h1 className="ob-h">{rail.head}</h1>
              <p className="ob-sub">{rail.sub}</p>
            </div>
            <ol className="ob-stepper" aria-label="Setup progress">
              {STEP_NAMES.map((name, i) => {
                const state = i < step ? "is-done" : i === step ? "is-current" : ""
                return (
                  <li key={name} className={state} aria-current={i === step ? "step" : undefined}>
                    <span className="ob-step-dot">{i < step ? <IconCheck /> : i + 1}</span>
                    <span className="ob-step-name">{name}</span>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="ob-accent">
            <span className="ob-accent-ic"><IconSpark /></span>
            <div className="ob-accent-body">
              <h5>A daily brief, built for you</h5>
              <p>Competitor moves, demand swings, and reputation shifts — ranked, with the play to make.</p>
            </div>
          </div>
        </aside>

        {/* RIGHT — floating panel with the step form */}
        <main className="ob-stage">
          <section className="ob-panel" key={step} aria-live="polite">
            {/* mobile-only compact head + horizontal progress (rail is hidden) */}
            <div className="ob-mobile-head">
              <span className="ob-kicker">{rail.kicker}</span>
              <h1 className="ob-h">{rail.head}</h1>
              <p className="ob-sub">{rail.sub}</p>
              <div className="ob-progress" aria-hidden="true">
                {Array.from({ length: TOTAL }).map((_, i) => (
                  <i key={i} className={i < step ? "done" : i === step ? "current" : ""} />
                ))}
              </div>
            </div>

            {setupMode ? (
              <div className="ob-setup-banner">
                <IconInfo />
                <span>
                  Admin setup{setupOrgName ? ` — ${setupOrgName}` : ""}. This won&apos;t
                  bill or email anyone — it builds the demo&apos;s data so you can show it.
                </span>
              </div>
            ) : null}

            {step === 0 ? (
              <>
                <span className="ob-panel-eyebrow">Find your restaurant</span>
                <h2 className="ob-panel-title">Search for your place</h2>
                <p className="ob-panel-lede">
                  We&apos;ll pull your address, cuisine, and the competitors near
                  you from your public listing — automatically.
                </p>
                <div className="ob-field">
                  <label className="ob-label" htmlFor="ob-rest">Your restaurant</label>
                  {place ? (
                    <div className="ob-selected">
                      <div>
                        <div className="ob-selected__name">{place.name}</div>
                        {place.address_line1 ? (
                          <div className="ob-selected__addr">{place.address_line1}</div>
                        ) : null}
                      </div>
                      <button type="button" className="ob-selected__change" onClick={clearPlace}>
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="ob-ac">
                      <input
                        id="ob-rest"
                        className="ob-input ob-input--lg"
                        value={query}
                        autoComplete="off"
                        onChange={(e) => {
                          setQuery(e.target.value)
                          setListOpen(true)
                        }}
                        onFocus={() => predictions.length && setListOpen(true)}
                        placeholder="Start typing your restaurant name…"
                      />
                      {listOpen && predictions.length ? (
                        <ul className="ob-ac__list">
                          {predictions.map((p) => (
                            <li key={p.place_id}>
                              <button type="button" className="ob-ac__item" onClick={() => pick(p)}>
                                {p.description}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                  {loadingPlace ? <p className="ob-hint">Pulling your listing…</p> : null}
                  {placeError ? <div className="ob-alert"><IconAlert />{placeError}</div> : null}
                </div>
                <div className="ob-nav">
                  <button
                    className="ob-btn ob-btn--act"
                    onClick={() => setStep(1)}
                    disabled={!place || loadingPlace}
                  >
                    Continue
                    <IconArrow />
                  </button>
                </div>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <span className="ob-panel-eyebrow">Confirm details</span>
                <h2 className="ob-panel-title">
                  Does this look right?
                  <span className="ob-derived"><IconCheck /> auto-filled</span>
                </h2>
                <p className="ob-panel-lede">
                  We pulled this from your listing. Fix anything that&apos;s off.
                </p>
                <div className="ob-grid">
                  <div className="full ob-field">
                    <label className="ob-label" htmlFor="ob-name">Restaurant</label>
                    <input
                      id="ob-name"
                      className="ob-input"
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                    />
                  </div>
                  <div className="full ob-field">
                    <label className="ob-label" htmlFor="ob-addr">Address</label>
                    <input
                      id="ob-addr"
                      className="ob-input"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Street, city, state"
                    />
                  </div>
                  <div className="ob-field">
                    <label className="ob-label" htmlFor="ob-cuisine">Cuisine</label>
                    <input
                      id="ob-cuisine"
                      className="ob-input"
                      value={cuisine}
                      onChange={(e) => setCuisine(e.target.value)}
                      placeholder="e.g. Steakhouse"
                    />
                  </div>
                  <div className="ob-field">
                    <label className="ob-label" htmlFor="ob-site">Website</label>
                    <input
                      id="ob-site"
                      className="ob-input"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="yourrestaurant.com"
                    />
                  </div>
                </div>
                {createError ? <div className="ob-alert"><IconAlert />{createError}</div> : null}
                <div className="ob-nav">
                  <button className="ob-btn ob-btn--ghost" onClick={() => setStep(0)} disabled={creating}>
                    Back
                  </button>
                  <button
                    className="ob-btn ob-btn--act"
                    onClick={handleConfirmDetails}
                    disabled={creating || !bizName.trim() || !place}
                  >
                    {creating ? "Setting up…" : "Looks good"}
                    {!creating ? <IconArrow /> : null}
                  </button>
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <span className="ob-panel-eyebrow">Competitors</span>
                <h2 className="ob-panel-title">Here&apos;s who we&apos;d watch</h2>
                <p className="ob-panel-lede">
                  {discovering
                    ? "Scanning your neighborhood for similar spots…"
                    : selected.length
                      ? "Remove any that aren't real competitors, or add your own. Keep at least one and we'll start tracking them."
                      : "Add the competitors you want us to watch. Keep at least one."}
                </p>
                {discovering ? <div className="ob-sweep" /> : null}
                {discoveryError ? (
                  <>
                    <div className="ob-alert"><IconAlert />{discoveryError}</div>
                    <div className="ob-nav">
                      <button
                        className="ob-btn ob-btn--ghost ob-btn--sm"
                        onClick={() => locationId && discover(locationId)}
                      >
                        Try again
                      </button>
                    </div>
                  </>
                ) : null}
                <div className="ob-comps">
                  {selected.map((c) => (
                    <div className="ob-comp" key={c.id}>
                      <div className="ob-comp__body">
                        <div className="ob-comp__name">{c.name ?? "Unnamed"}</div>
                        {metaLine(c) ? <div className="ob-comp__meta">{metaLine(c)}</div> : null}
                        <div className="ob-comp__why">
                          <span className="ob-comp__why-label">Why</span>
                          {whyLine(c)}
                        </div>
                      </div>
                      <button
                        className="ob-comp__remove"
                        onClick={() => removeCompetitor(c.id)}
                        aria-label={`Remove ${c.name ?? "competitor"}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {adding ? (
                    <>
                      <div className="ob-comp ob-comp--add">
                        <input
                          className="ob-input"
                          value={searchQuery}
                          autoFocus
                          placeholder="Search any business by name…"
                          aria-label="Search for a competitor"
                          onChange={(e) => {
                            setSearchQuery(e.target.value)
                            setAddError(null)
                          }}
                        />
                        <button
                          className="ob-btn ob-btn--ghost ob-btn--sm"
                          onClick={() => {
                            setAdding(false)
                            setSearchQuery("")
                            setCompPredictions([])
                            setAddError(null)
                          }}
                        >
                          Done
                        </button>
                      </div>
                      {addError ? (
                        <div className="ob-alert"><IconAlert />{addError}</div>
                      ) : null}
                      {/* Already-suggested candidates that match what's typed. */}
                      {suggestions.map((c) => (
                        <div className="ob-comp" key={c.id}>
                          <div className="ob-comp__body">
                            <div className="ob-comp__name">{c.name ?? "Unnamed"}</div>
                            {metaLine(c) ? <div className="ob-comp__meta">{metaLine(c)}</div> : null}
                          </div>
                          <button
                            className="ob-btn ob-btn--act ob-btn--sm"
                            onClick={() => addCompetitor(c.id)}
                            disabled={selectedIds.size >= MAX_TRACKED}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                      {/* Fresh Places matches for anything we didn't already suggest. */}
                      {compPredictions
                        .filter(
                          (p) =>
                            !competitors.some(
                              (c) =>
                                c.provider_entity_id === p.place_id &&
                                (selectedIds.has(c.id) ||
                                  suggestions.some((s) => s.id === c.id))
                            )
                        )
                        .map((p) => (
                          <div className="ob-comp" key={p.place_id}>
                            <div className="ob-comp__body">
                              <div className="ob-comp__name">{p.description}</div>
                            </div>
                            <button
                              className="ob-btn ob-btn--act ob-btn--sm"
                              onClick={() => pickCompetitor(p)}
                              disabled={
                                selectedIds.size >= MAX_TRACKED || addingPlaceId !== null
                              }
                            >
                              {addingPlaceId === p.place_id ? "Adding…" : "Add"}
                            </button>
                          </div>
                        ))}
                      {searching && compPredictions.length === 0 ? (
                        <p className="ob-hint">Searching…</p>
                      ) : null}
                      {!searching &&
                      searchQuery.trim().length >= 2 &&
                      compPredictions.length === 0 &&
                      suggestions.length === 0 ? (
                        <p className="ob-hint">No matches yet — keep typing the name.</p>
                      ) : null}
                      {selectedIds.size >= MAX_TRACKED ? (
                        <p className="ob-hint">
                          You&apos;re tracking the max of {MAX_TRACKED} — remove one to add another.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <button className="ob-add" onClick={() => setAdding(true)}>
                      + Add a competitor
                    </button>
                  )}
                </div>
                <div className="ob-nav">
                  <button
                    className="ob-btn ob-btn--act"
                    onClick={() => setStep(3)}
                    disabled={selected.length < 1 || discovering}
                  >
                    Track these {selected.length}
                    <IconArrow />
                  </button>
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <span className="ob-panel-eyebrow">Optional · pick any that apply</span>
                <h2 className="ob-panel-title">Anything you&apos;re focused on?</h2>
                <p className="ob-panel-lede">
                  We watch all of this by default — switch off anything you
                  don&apos;t care about. Change these anytime in Settings, or skip.
                </p>
                <div className="ob-goals">
                  {PREFS.map((p) => {
                    const on = !!monitoringPrefs[p.key]
                    return (
                      <button
                        key={p.key}
                        className={`ob-goal${on ? " is-on" : ""}`}
                        onClick={() => togglePref(p.key)}
                        aria-pressed={on}
                      >
                        <span className="ob-goal__check" aria-hidden>
                          {on ? <IconCheck /> : null}
                        </span>
                        <span className="ob-goal__text">
                          <b>{p.title}</b>
                          <span>{p.sub}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="ob-nav">
                  <button className="ob-btn ob-btn--ghost" onClick={() => setStep(2)}>
                    Back
                  </button>
                  <button className="ob-btn ob-btn--act" onClick={() => setStep(4)}>
                    Continue
                    <IconArrow />
                  </button>
                  <button className="ob-skip" onClick={() => setStep(4)}>
                    Skip
                  </button>
                </div>
              </>
            ) : null}

            {step === 4 && orgId && locationId ? (
              <ProcessingStep
                orgId={orgId}
                locationId={locationId}
                competitorIds={Array.from(selectedIds)}
                monitoringPrefs={monitoringPrefs}
                setupMode={setupMode}
              />
            ) : null}
          </section>
        </main>
      </div>
    </div>
  )
}
