"use client"

import { useFormStatus } from "react-dom"
import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"

// ---------------------------------------------------------------------------
// Simulated progress steps — gives the user a sense of work happening
// ---------------------------------------------------------------------------
const DEFAULT_STEPS = [
  "Connecting to data providers...",
  "Fetching domain data...",
  "Analyzing keywords...",
  "Comparing competitors...",
  "Processing results...",
  "Building insights...",
  "Almost there...",
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
type RefreshOverlayProps = {
  /** Button label when idle */
  label: string
  /** Status text prefix while pending */
  pendingLabel?: string
  /** Pre-built insight cards from existing data */
  quickFacts?: string[]
  /** Short context string for the Gemini quick-tip API */
  geminiContext?: string
  /** Custom progress step labels */
  steps?: string[]
  /** Extra classes on the wrapper */
  className?: string
}

// ---------------------------------------------------------------------------
// Inner component (needs to be inside a <form> to use useFormStatus)
// ---------------------------------------------------------------------------
function RefreshOverlayInner({
  label,
  pendingLabel,
  quickFacts = [],
  geminiContext,
  steps = DEFAULT_STEPS,
  className,
}: RefreshOverlayProps) {
  const { pending } = useFormStatus()
  const [factIndex, setFactIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [allFacts, setAllFacts] = useState<string[]>(quickFacts)
  const geminiCalled = useRef(false)

  // Cycle through insight facts every 4 seconds
  useEffect(() => {
    if (!pending || allFacts.length === 0) return
    const interval = setInterval(() => {
      setFactIndex((i) => (i + 1) % allFacts.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [pending, allFacts])

  // Cycle through progress steps every 6 seconds
  useEffect(() => {
    if (!pending) return
    setStepIndex(0)
    const interval = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1))
    }, 6000)
    return () => clearInterval(interval)
  }, [pending, steps.length])

  // Fire a Gemini quick-tip call when overlay appears
  useEffect(() => {
    if (!pending || !geminiContext || geminiCalled.current) return
    geminiCalled.current = true

    fetch("/api/ai/quick-tip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: geminiContext }),
    })
      .then((r) => r.json())
      .then((data: { tip?: string | null }) => {
        if (data.tip) {
          setAllFacts((prev) => [...prev, `Tip: ${data.tip}`])
        }
      })
      .catch(() => {})
  }, [pending, geminiContext])

  // Reset when form stops pending
  useEffect(() => {
    if (!pending) {
      geminiCalled.current = false
      setFactIndex(0)
      setStepIndex(0)
      setAllFacts(quickFacts)
    }
  }, [pending, quickFacts])

  // ----- Idle state: show a nice button -----
  if (!pending) {
    return (
      <button
        type="submit"
        className={`rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 ${className ?? ""}`}
      >
        {label}
      </button>
    )
  }

  // ----- Pending state: animated overlay -----
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35 }}
      className="w-full rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-5 shadow-lg"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Left: progress indicator */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* Pulsing spinner */}
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-30" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-indigo-900">
                {pendingLabel ?? label}
              </p>
              <AnimatePresence mode="wait">
                <motion.p
                  key={stepIndex}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.3 }}
                  className="text-xs text-indigo-600/70"
                >
                  {steps[stepIndex]}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
            <motion.div
              className="h-full rounded-full bg-indigo-500"
              initial={{ width: "5%" }}
              animate={{
                width: `${Math.min(15 + stepIndex * (75 / steps.length), 90)}%`,
              }}
              transition={{ duration: 5, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Right: rotating insight card */}
        {allFacts.length > 0 && (
          <div className="relative min-h-[60px] w-full overflow-hidden sm:w-[280px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={factIndex}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
                className="rounded-xl border border-slate-200/60 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-sm"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                  Did you know?
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-700">
                  {allFacts[factIndex]}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Export (the parent <form> provides the action, this sits inside it)
// ---------------------------------------------------------------------------
export default function RefreshOverlay(props: RefreshOverlayProps) {
  return <RefreshOverlayInner {...props} />
}
