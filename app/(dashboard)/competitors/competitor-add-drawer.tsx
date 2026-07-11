"use client"

// Add-a-competitor drawer — search + neighborhood suggestions in one focused
// surface (right slide-over desktop, bottom sheet mobile, portaled so no
// stacking-context fight with the page). Replaces the cramped in-card
// typeahead: the operator either knows exactly who they want (search leads,
// input focused on open) or wants to know who they're missing ("Suggested
// for you" below, powered by the same identity-aware discovery onboarding
// uses — plain-language why per pick). Adds are immediate: the first data
// pull starts on add, so the drawer says so and stays open for more adds.
//
// Suggestions come from the location's pending candidates; when there are
// none on first open, a scan runs automatically (server-side rate limit
// caps spend). "Scan again" re-runs it quietly.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { TkDrawer, TkButton, TkChip } from "@/components/ticket"
import { addCompetitorAction } from "./actions"
import { discoverCompetitorsForLocation } from "@/app/onboarding/actions"

export type SuggestedCompetitor = {
  id: string
  name: string | null
  category: string | null
  address: string | null
  provider_entity_id: string | null
  metadata: Record<string, unknown>
  relevance_score: number | null
}

type Prediction = { place_id: string; description: string; distance_meters?: number | null }

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatMiles(meters: number): string {
  return Math.max(0.1, meters * 0.000621371).toFixed(1)
}

function prettyCategory(category: string | null | undefined): string {
  if (!category) return ""
  const s = category.replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function metaLine(c: SuggestedCompetitor): string {
  const parts: string[] = []
  if (c.category) parts.push(prettyCategory(c.category))
  const dist = num(c.metadata.distanceMeters)
  if (dist !== null) parts.push(`${formatMiles(dist)} mi`)
  const rating = num(c.metadata.rating)
  if (rating !== null) parts.push(`${rating.toFixed(1)}★`)
  return parts.join(" · ")
}

function whyLine(c: SuggestedCompetitor): string {
  const written = typeof c.metadata.why === "string" ? c.metadata.why.trim() : ""
  if (written) return written
  const dist = num(c.metadata.distanceMeters)
  const parts: string[] = [c.category ? prettyCategory(c.category) : "Nearby spot"]
  if (dist !== null) parts.push(`${formatMiles(dist)} mi away`)
  return parts.join(", ")
}

export default function CompetitorAddDrawer({
  open,
  onClose,
  locationId,
  locationGeo,
  initialSuggestions,
  watchedCount,
  competitorLimit,
  tierLabel,
}: {
  open: boolean
  onClose: () => void
  locationId: string
  locationGeo?: { lat: number; lng: number } | null
  initialSuggestions: SuggestedCompetitor[]
  /** Live count of actively watched competitors (roster rows). */
  watchedCount: number
  competitorLimit?: number
  tierLabel: string
}) {
  const router = useRouter()

  // Suggestions
  const [suggestions, setSuggestions] = useState<SuggestedCompetitor[]>(initialSuggestions)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const autoScanRef = useRef(false)
  // Re-sync from the server between sessions (render-time derived state) — but
  // only while CLOSED, so an in-progress session's list doesn't shift underfoot.
  const [prevInitial, setPrevInitial] = useState(initialSuggestions)
  if (!open && prevInitial !== initialSuggestions) {
    setPrevInitial(initialSuggestions)
    setSuggestions(initialSuggestions)
  }

  // Search
  const [query, setQuery] = useState("")
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchedFor, setSearchedFor] = useState("")

  // Adds
  const [addingPlaceId, setAddingPlaceId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [addedPlaceIds, setAddedPlaceIds] = useState<Set<string>>(new Set())

  // TkDrawer moves focus to its close button ~30ms after open (a11y default);
  // for this flow the search input is the point, so claim focus just after.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(t)
  }, [open])

  const watching = watchedCount
  const atLimit = competitorLimit != null && watching >= competitorLimit

  async function scan() {
    if (scanning) return
    setScanning(true)
    setScanError(null)
    try {
      const result = await discoverCompetitorsForLocation(locationId)
      if (result.ok) {
        setSuggestions(result.competitors)
      } else {
        setScanError(result.error)
      }
    } catch {
      setScanError("The scan didn't finish. Try again in a moment.")
    } finally {
      setScanning(false)
    }
  }

  // First open with nothing to suggest: scan once automatically.
  useEffect(() => {
    if (!open || autoScanRef.current) return
    autoScanRef.current = true
    if (initialSuggestions.length === 0) void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Debounced biased typeahead (same shape as onboarding step 2).
  const searchLat = locationGeo?.lat ?? null
  const searchLng = locationGeo?.lng ?? null
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setPredictions([])
      setSearching(false)
      return
    }
    setSearching(true)
    // `cancelled` covers the in-flight fetch too: without it, a response landing
    // after the query changed/cleared would repopulate stale predictions.
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const bias =
          searchLat !== null && searchLng !== null
            ? `&lat=${searchLat}&lng=${searchLng}&radius=50000`
            : ""
        const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(q)}${bias}`)
        const data = await res.json()
        if (cancelled) return
        if (data.ok) {
          setPredictions((data.predictions ?? []).slice(0, 5))
          setSearchError(null)
        } else {
          setPredictions([])
          setSearchError("Search isn't responding right now. Give it a moment and try again.")
        }
        setSearchedFor(q)
      } catch {
        if (cancelled) return
        setPredictions([])
        setSearchError("Search isn't responding right now. Give it a moment and try again.")
        setSearchedFor(q)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
      setSearching(false)
    }
  }, [open, query, searchLat, searchLng])

  async function pick(placeId: string) {
    if (addingPlaceId || atLimit) return
    setAddingPlaceId(placeId)
    setAddError(null)
    try {
      const res = await addCompetitorAction({ locationId, placeId })
      if (res.ok) {
        setAddedPlaceIds((prev) => new Set(prev).add(placeId))
        setQuery("")
        setPredictions([])
        // Refresh the roster behind the scrim; the drawer stays open for more adds.
        router.refresh()
      } else {
        setAddError(res.error)
      }
    } catch {
      setAddError("That didn't save. Try again.")
    } finally {
      setAddingPlaceId(null)
    }
  }

  const suggestionPlaceIds = new Set(
    suggestions.map((s) => s.provider_entity_id).filter(Boolean) as string[]
  )
  const visiblePredictions = predictions.filter((p) => !suggestionPlaceIds.has(p.place_id))

  function addButton(placeId: string | null) {
    if (!placeId) return null
    if (addedPlaceIds.has(placeId)) {
      return (
        <span className="tk-cadd-watching" role="status">
          Watching
        </span>
      )
    }
    return (
      <TkButton
        variant="add"
        onClick={() => pick(placeId)}
        disabled={atLimit || addingPlaceId !== null}
      >
        {addingPlaceId === placeId ? "Adding…" : "Add"}
      </TkButton>
    )
  }

  return (
    <TkDrawer
      open={open}
      onClose={onClose}
      portal
      chip={<TkChip family="competitive">Your market</TkChip>}
      title="Add a competitor"
    >
      <div className="tk-cadd">
        <p className="tk-cadd-lede">
          Track a spot you have your eye on, or pick from what we found nearby. We start
          pulling a new rival&apos;s data the moment you add them.
        </p>

        {atLimit ? (
          <div className="tk-cadd-limit" role="status">
            Watching {watching} of {competitorLimit}, set by your plan ({tierLabel}). Stop
            watching one to make room, or upgrade your plan for more.
          </div>
        ) : null}

        <div className="tk-cadd-search">
          <input
            ref={inputRef}
            className="tk-cadd-input"
            value={query}
            placeholder="Search any business by name…"
            aria-label="Search for a competitor"
            onChange={(e) => {
              setQuery(e.target.value)
              setSearchError(null)
              setAddError(null)
            }}
          />
          {addError || searchError ? (
            <p className="tk-cadd-alert" role="alert">
              {addError ?? searchError}
            </p>
          ) : null}
          {visiblePredictions.map((p) => (
            <div className="tk-cadd-row" key={p.place_id}>
              <div className="tk-cadd-row-body">
                <div className="tk-cadd-row-name">{p.description}</div>
                {typeof p.distance_meters === "number" ? (
                  <div className="tk-cadd-row-meta">{formatMiles(p.distance_meters)} mi away</div>
                ) : null}
              </div>
              {addButton(p.place_id)}
            </div>
          ))}
          {searching && visiblePredictions.length === 0 ? (
            <p className="tk-cadd-hint">Searching…</p>
          ) : null}
          {!searching &&
          !searchError &&
          query.trim().length >= 2 &&
          searchedFor === query.trim() &&
          visiblePredictions.length === 0 ? (
            <p className="tk-cadd-hint">No matches yet. Keep typing the name.</p>
          ) : null}
        </div>

        <div className="tk-cadd-sec">
          <span className="tk-cadd-sec-title">Suggested for you</span>
          {!scanning && suggestions.length > 0 ? (
            <TkButton variant="ghost" onClick={() => void scan()}>
              Scan again
            </TkButton>
          ) : null}
        </div>

        {scanning ? (
          <p className="tk-cadd-hint tk-cadd-scanning" role="status">
            Sizing up the neighborhood. This takes about half a minute.
          </p>
        ) : scanError ? (
          <div className="tk-cadd-alert" role="alert">
            {scanError}{" "}
            <TkButton variant="ghost" onClick={() => void scan()}>
              Try again
            </TkButton>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="tk-cadd-empty">
            <p className="tk-cadd-hint">
              Nothing new nearby right now. Search above for anyone we missed.
            </p>
            <TkButton variant="ghost" onClick={() => void scan()}>
              Scan again
            </TkButton>
          </div>
        ) : (
          <div className="tk-cadd-list">
            {suggestions.map((s) => (
              <div className="tk-cadd-row tk-cadd-row--suggest" key={s.id}>
                <div className="tk-cadd-row-body">
                  <div className="tk-cadd-row-name">{s.name ?? "Unnamed"}</div>
                  {metaLine(s) ? <div className="tk-cadd-row-meta">{metaLine(s)}</div> : null}
                  <div className="tk-cadd-row-why">
                    <span className="tk-cadd-why-label">Why</span>
                    {whyLine(s)}
                  </div>
                </div>
                {addButton(s.provider_entity_id)}
              </div>
            ))}
          </div>
        )}
      </div>
    </TkDrawer>
  )
}
