"use client"

// Authed onboarding — the editorial step-through from app/preview-onboarding,
// wired to the REAL server actions. Five steps: find restaurant (Places
// autocomplete) → confirm details (creates org + location, kicks competitor
// discovery) → confirm competitors (≥1 required) → optional monitoring prefs →
// processing (completeOnboardingAction + honest per-pipeline job status polled
// from /api/onboarding/progress — no fake progress bars).

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import "./onboarding.css"
import {
  createOrgAndLocationAction,
  discoverCompetitorsForLocation,
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
  metadata: Record<string, unknown>
  relevance_score: number | null
}

type WizardProps = {
  existingOrgId?: string | null
  existingLocationId?: string | null
  existingCompetitors?: OnboardingCandidate[]
  verticalConfig?: VerticalConfig
}

const PREFS: Array<{ key: string; title: string; sub: string }> = [
  { key: "pricing_changes", title: "Pricing changes", sub: "When competitors move their prices." },
  { key: "menu_updates", title: "Menu updates", sub: "New dishes and menu changes nearby." },
  { key: "promotions", title: "Promotions", sub: "Deals and specials competitors run." },
  { key: "review_activity", title: "Review activity", sub: "Review spikes and sentiment shifts." },
  { key: "new_openings", title: "New openings", sub: "New spots opening in your area." },
]

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

// Human "why we picked it" from the scoring metadata.
function whyLine(c: OnboardingCandidate): string {
  const factors = Array.isArray(c.metadata.factors)
    ? (c.metadata.factors as Array<{ label?: string; value?: number }>)
    : []
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
}

// Step 4 — runs completion once, then shows real signal_jobs statuses.
function ProcessingStep({
  orgId,
  locationId,
  competitorIds,
  monitoringPrefs,
}: {
  orgId: string
  locationId: string
  competitorIds: string[]
  monitoringPrefs: Record<string, boolean>
}) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Array<{ pipeline: string; status: string }> | null>(null)
  const [completionDone, setCompletionDone] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const startedRef = useRef(false)

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

  // Poll the authed progress route every ~4s for real job statuses.
  useEffect(() => {
    let cancelled = false
    async function poll() {
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
    const timer = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [locationId])

  // Don't hold people hostage: after ~90s they can enter even if jobs run on.
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 90_000)
    return () => clearTimeout(timer)
  }, [])

  const statusByPipeline = new Map((jobs ?? []).map((j) => [j.pipeline, j.status]))
  const insightsDone = statusByPipeline.get("insights") === "done"
  const allDone =
    jobs !== null && jobs.length > 0 && jobs.every((j) => j.status === "done")
  const canEnter = completionDone && !completionError && (insightsDone || timedOut)

  return (
    <>
      <span className="ob-kicker">You&apos;re set</span>
      <h1 className="ob-h">We&apos;re building your first brief.</h1>
      <p className="ob-sub">
        We&apos;re pulling competitor, demand, and review signals now. Each row below is
        live status from the pipeline — the essentials land in a few minutes, insights
        come last.
      </p>

      {completionError ? (
        <>
          <div className="ob-alert">{completionError}</div>
          <div className="ob-nav">
            <button className="ob-btn" onClick={() => { setCompletionDone(false); void runCompletion() }}>
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
                  Still working — data keeps landing after you enter. Your brief fills
                  in as each signal finishes.
                </p>
              ) : null}
              <div className="ob-nav">
                <button className="ob-btn" onClick={() => router.push("/home")}>
                  Open your brief →
                </button>
              </div>
            </>
          ) : (
            <p className="ob-hint">This usually takes a minute or two. Hang tight.</p>
          )}
        </>
      )}
    </>
  )
}

export default function OnboardingWizard({
  existingOrgId,
  existingLocationId,
  existingCompetitors,
  verticalConfig: externalConfig,
}: WizardProps) {
  const verticalConfig = externalConfig ?? getVerticalConfig()
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
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestIdRef = useRef(0)

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
          undefined,
          verticalConfig.placesApiType
        )
        if (result.ok) {
          setCompetitors(result.competitors)
          setSelectedIds((prev) =>
            prev.size > 0
              ? prev
              : new Set(result.competitors.slice(0, MAX_TRACKED).map((c) => c.id))
          )
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

  // Resume at step 2 with no candidates yet → re-run discovery once.
  const resumeDiscoveryRef = useRef(false)
  useEffect(() => {
    if (resumeDiscoveryRef.current) return
    resumeDiscoveryRef.current = true
    if (initialStep === 2 && existingLocationId && (existingCompetitors ?? []).length === 0) {
      void discover(existingLocationId)
    }
  }, [initialStep, existingLocationId, existingCompetitors, discover])

  // Creates the org + location, then kicks discovery while step 2 shows progress.
  async function handleConfirmDetails() {
    if (!place || !bizName.trim() || creating) return
    setCreating(true)
    setCreateError(null)
    const result = await createOrgAndLocationAction({
      businessName: bizName.trim(),
      cuisine: cuisine.trim() || null,
      industryType: verticalConfig.industryType,
      place: {
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
      },
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

  // Step 2 search — debounced server-side discovery with the typed query;
  // results merge into the candidate pool (dedup by id).
  function handleSearchChange(value: string) {
    setSearchQuery(value)
    if (!locationId) return
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    const q = value.trim()
    if (q.length < 3) {
      setSearching(false)
      return
    }
    searchDebounceRef.current = setTimeout(async () => {
      const requestId = ++searchRequestIdRef.current
      setSearching(true)
      try {
        const result = await discoverCompetitorsForLocation(
          locationId,
          q,
          verticalConfig.placesApiType
        )
        if (requestId !== searchRequestIdRef.current) return
        if (result.ok) {
          setCompetitors((existing) => {
            const byId = new Map(existing.map((c) => [c.id, c]))
            for (const c of result.competitors) byId.set(c.id, c)
            return Array.from(byId.values())
          })
        }
      } catch {
        // keep current candidates on search failure
      } finally {
        if (requestId === searchRequestIdRef.current) setSearching(false)
      }
    }, 400)
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

  return (
    <div className="ob">
      <div className="ob-top">
        <span className="ob-brand">TICKET</span>
        <span className="ob-steplabel">
          {step < TOTAL - 1 ? `Step ${step + 1} of ${TOTAL - 1}` : "All set"}
        </span>
      </div>
      <div className="ob-progress">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <i key={i} className={i < step ? "done" : i === step ? "current" : ""} />
        ))}
      </div>

      <div className="ob-card" key={step}>
        {step === 0 ? (
          <>
            <span className="ob-kicker">Welcome to Ticket</span>
            <h1 className="ob-h">Let&apos;s find your restaurant.</h1>
            <p className="ob-sub">
              Search for your place and we&apos;ll pull everything we can from your
              public listing, so you barely have to type.
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
              <p className="ob-hint">
                We use your Google listing to get your address, cuisine, and the
                competitors near you, automatically.
              </p>
              {loadingPlace ? <p className="ob-hint">Pulling your listing…</p> : null}
              {placeError ? <div className="ob-alert">{placeError}</div> : null}
            </div>
            <div className="ob-nav">
              <button
                className="ob-btn"
                onClick={() => setStep(1)}
                disabled={!place || loadingPlace}
              >
                Continue
              </button>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <span className="ob-kicker">Step 2 · mostly done for you</span>
            <h1 className="ob-h">Does this look right?</h1>
            <p className="ob-sub">
              We pulled this from your listing
              <span className="ob-derived">✓ auto-filled</span>. Fix anything
              that&apos;s off.
            </p>
            <div className="ob-grid">
              <div className="full">
                <label className="ob-label" htmlFor="ob-name">Restaurant</label>
                <input
                  id="ob-name"
                  className="ob-input"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                />
              </div>
              <div className="full">
                <label className="ob-label" htmlFor="ob-addr">Address</label>
                <input
                  id="ob-addr"
                  className="ob-input"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, city, state"
                />
              </div>
              <div>
                <label className="ob-label" htmlFor="ob-cuisine">Cuisine</label>
                <input
                  id="ob-cuisine"
                  className="ob-input"
                  value={cuisine}
                  onChange={(e) => setCuisine(e.target.value)}
                  placeholder="e.g. Steakhouse"
                />
              </div>
              <div>
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
            {createError ? <div className="ob-alert">{createError}</div> : null}
            <div className="ob-nav">
              <button className="ob-btn--ghost ob-btn" onClick={() => setStep(0)} disabled={creating}>
                Back
              </button>
              <button
                className="ob-btn"
                onClick={handleConfirmDetails}
                disabled={creating || !bizName.trim() || !place}
              >
                {creating ? "Setting up…" : "Looks good"}
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <span className="ob-kicker">Step 3 · found for you</span>
            <h1 className="ob-h">Here&apos;s who we&apos;d watch.</h1>
            <p className="ob-sub">
              {discovering
                ? "Scanning your neighborhood for similar spots…"
                : selected.length
                  ? "We found these nearby, similar spots automatically — each with why we picked it. Remove any that aren't real competitors, or add your own. Keep at least one and we'll start tracking them."
                  : "Add the competitors you want us to watch. Keep at least one."}
            </p>
            {discovering ? <div className="ob-sweep" /> : null}
            {discoveryError ? (
              <>
                <div className="ob-alert">{discoveryError}</div>
                <div className="ob-nav">
                  <button
                    className="ob-btn--ghost ob-btn ob-btn--sm"
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
                      placeholder="Search restaurants near you…"
                      aria-label="Search for a competitor"
                      onChange={(e) => handleSearchChange(e.target.value)}
                    />
                    <button
                      className="ob-btn--ghost ob-btn ob-btn--sm"
                      onClick={() => {
                        setAdding(false)
                        setSearchQuery("")
                      }}
                    >
                      Done
                    </button>
                  </div>
                  {searching ? <p className="ob-hint">Searching…</p> : null}
                  {suggestions.map((c) => (
                    <div className="ob-comp" key={c.id}>
                      <div className="ob-comp__body">
                        <div className="ob-comp__name">{c.name ?? "Unnamed"}</div>
                        {metaLine(c) ? <div className="ob-comp__meta">{metaLine(c)}</div> : null}
                      </div>
                      <button
                        className="ob-btn ob-btn--sm"
                        onClick={() => addCompetitor(c.id)}
                        disabled={selectedIds.size >= MAX_TRACKED}
                      >
                        Add
                      </button>
                    </div>
                  ))}
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
                className="ob-btn"
                onClick={() => setStep(3)}
                disabled={selected.length < 1 || discovering}
              >
                Track these {selected.length}
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <span className="ob-kicker">Optional · pick any that apply</span>
            <h1 className="ob-h">Anything you&apos;re focused on?</h1>
            <p className="ob-sub">
              We watch all of this by default — switch off anything you don&apos;t
              care about. You can change these anytime in Settings, or skip for now.
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
                      {on ? "✓" : ""}
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
              <button className="ob-btn--ghost ob-btn" onClick={() => setStep(2)}>
                Back
              </button>
              <button className="ob-btn" onClick={() => setStep(4)}>
                Continue
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
          />
        ) : null}
      </div>
    </div>
  )
}
