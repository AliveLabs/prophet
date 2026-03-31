"use client"

import { useState, useCallback, useTransition } from "react"
import { motion, AnimatePresence } from "framer-motion"
import "./onboarding.css"
import SplashStep from "./steps/splash"
import RestaurantInfoStep from "./steps/restaurant-info"
import CompetitorSelectionStep from "./steps/competitor-selection"
import IntelligenceSettingsStep from "./steps/intelligence-settings"
import LoadingBriefStep from "./steps/loading-brief"
import type { PlaceDetails } from "@/components/places/location-search"
import ThemeToggle from "@/components/ui/theme-toggle"
import {
  createOrgAndLocationAction,
  discoverCompetitorsForLocation,
} from "./actions"

const TOTAL_STEPS = 4
const STEP_LABELS = [
  "",
  "Your Restaurant",
  "Your Competitors",
  "What to Watch",
  "Your First Brief",
]

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
}

export default function OnboardingWizard({
  existingOrgId,
  existingLocationId,
  existingCompetitors,
}: WizardProps) {
  const initialStep = existingOrgId && existingLocationId ? 2 : 0

  const [step, setStep] = useState(initialStep)
  const [direction, setDirection] = useState<"fwd" | "back">("fwd")

  // Step 1 state
  const [restaurantName, setRestaurantName] = useState("")
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null)
  const [cuisine, setCuisine] = useState<string | null>(null)

  // Org/location IDs (from Step 1 creation or resume)
  const [orgId, setOrgId] = useState<string | null>(existingOrgId ?? null)
  const [locationId, setLocationId] = useState<string | null>(
    existingLocationId ?? null
  )

  // Step 2 state
  const [competitors, setCompetitors] = useState<OnboardingCandidate[]>(
    existingCompetitors ?? []
  )
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<Set<string>>(
    new Set()
  )
  const [discoveringCompetitors, setDiscoveringCompetitors] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)

  // Step 3 state
  const [monitoringPrefs, setMonitoringPrefs] = useState({
    pricing_changes: true,
    menu_updates: true,
    promotions: true,
    review_activity: true,
    new_openings: true,
  })

  const [isPending, startTransition] = useTransition()

  const goTo = useCallback(
    (target: number, dir: "fwd" | "back" = "fwd") => {
      setDirection(dir)
      setStep(target)
    },
    []
  )

  const nextStep = useCallback(() => {
    if (step < TOTAL_STEPS) goTo(step + 1, "fwd")
  }, [step, goTo])

  const prevStep = useCallback(() => {
    if (step > 1) goTo(step - 1, "back")
  }, [step, goTo])

  const handleStep1Continue = useCallback(async () => {
    if (!restaurantName.trim() || !selectedPlace) return

    startTransition(async () => {
      const result = await createOrgAndLocationAction({
        restaurantName: restaurantName.trim(),
        cuisine,
        place: selectedPlace,
      })

      if (!result.ok) {
        return
      }

      setOrgId(result.orgId)
      setLocationId(result.locationId)
      goTo(2, "fwd")

      // Fire-and-forget competitor discovery
      setDiscoveringCompetitors(true)
      setDiscoveryError(null)
      try {
        const discovered = await discoverCompetitorsForLocation(result.locationId)
        if (discovered.ok) {
          setCompetitors(discovered.competitors)
        } else {
          setDiscoveryError(discovered.error)
        }
      } catch {
        setDiscoveryError("An unexpected error occurred during competitor discovery")
      } finally {
        setDiscoveringCompetitors(false)
      }
    })
  }, [restaurantName, selectedPlace, cuisine, goTo])

  const handleRetryDiscovery = useCallback(async () => {
    if (!locationId) return
    setDiscoveringCompetitors(true)
    setDiscoveryError(null)
    try {
      const discovered = await discoverCompetitorsForLocation(locationId)
      if (discovered.ok) {
        setCompetitors(discovered.competitors)
      } else {
        setDiscoveryError(discovered.error)
      }
    } catch {
      setDiscoveryError("An unexpected error occurred during competitor discovery")
    } finally {
      setDiscoveringCompetitors(false)
    }
  }, [locationId])

  const toggleCompetitor = useCallback((id: string) => {
    setSelectedCompetitorIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < 5) {
        next.add(id)
      }
      return next
    })
  }, [])

  const slideVariants = {
    enter: (dir: "fwd" | "back") => ({
      x: dir === "fwd" ? 22 : -22,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (dir: "fwd" | "back") => ({
      x: dir === "fwd" ? -22 : 22,
      opacity: 0,
    }),
  }

  const showChrome = step > 0

  return (
    <div className="relative z-[1] flex min-h-dvh flex-col items-center">
      <div className="ob-ambient" />

      {/* Header */}
      <header
        className={`flex w-full max-w-[520px] items-center justify-between px-6 pt-6 transition-all duration-300 ${
          showChrome
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1.5 opacity-0"
        }`}
      >
        <div className="font-display text-[21px] font-semibold tracking-wide text-foreground">
          V<span className="text-vatic-indigo">atic</span>
        </div>
        <ThemeToggle />
      </header>

      {/* Progress bar */}
      <div
        className={`w-full max-w-[520px] px-6 pt-5 transition-all duration-300 ${
          showChrome
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-vatic-indigo">
            {STEP_LABELS[step] ?? ""}
          </span>
          <span className="text-[11px] text-muted-foreground">
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-border/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-vatic-indigo to-vatic-indigo-soft transition-[width] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <main className="relative flex-1 w-full max-w-[520px] px-6">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              duration: 0.38,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {step === 0 && <SplashStep onContinue={nextStep} />}
            {step === 1 && (
              <RestaurantInfoStep
                restaurantName={restaurantName}
                onNameChange={setRestaurantName}
                selectedPlace={selectedPlace}
                onPlaceSelect={setSelectedPlace}
                cuisine={cuisine}
                onCuisineChange={setCuisine}
              />
            )}
            {step === 2 && (
              <CompetitorSelectionStep
                competitors={competitors}
                selectedIds={selectedCompetitorIds}
                onToggle={toggleCompetitor}
                isLoading={discoveringCompetitors}
                error={discoveryError}
                onRetry={handleRetryDiscovery}
                locationCity={selectedPlace?.city ?? null}
              />
            )}
            {step === 3 && (
              <IntelligenceSettingsStep
                preferences={monitoringPrefs}
                onChange={setMonitoringPrefs}
              />
            )}
            {step === 4 && (
              <LoadingBriefStep
                orgId={orgId!}
                locationId={locationId!}
                selectedCompetitorIds={Array.from(selectedCompetitorIds)}
                competitors={competitors}
                monitoringPrefs={monitoringPrefs}
                restaurantName={restaurantName}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer navigation */}
      {step > 0 && step < 4 && (
        <footer
          className={`flex w-full max-w-[520px] items-center gap-3 px-6 pb-10 pt-4 transition-all duration-300 ${
            showChrome
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-1.5 opacity-0"
          }`}
        >
          {step > 1 && (
            <button
              type="button"
              onClick={prevStep}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-5 py-3.5 text-sm font-semibold text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M9 2.5L4 7l5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back
            </button>
          )}
          <button
            type="button"
            onClick={
              step === 1
                ? handleStep1Continue
                : step === 3
                  ? () => goTo(4, "fwd")
                  : nextStep
            }
            disabled={
              isPending ||
              (step === 1 &&
                (!restaurantName.trim() ||
                  !selectedPlace?.geo_lat ||
                  !selectedPlace?.geo_lng))
            }
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-deep-indigo hover:shadow-glow-indigo-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending
              ? "Setting up..."
              : step === 3
                ? "Generate My Brief"
                : "Continue"}
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 2.5l5 4.5-5 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </footer>
      )}
    </div>
  )
}
