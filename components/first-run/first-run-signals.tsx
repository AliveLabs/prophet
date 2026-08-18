"use client"

// Progressive first-run signals — the presentation half (beta rescue 3.1).
//
// Deliberately dumb: every decision about what may be SAID is made by
// lib/onboarding/first-run-signals.ts, which is pure and unit-tested. This renders the result and
// nothing else, so the honesty rules cannot be quietly re-decided in JSX.
//
// Shared by the onboarding Build step and /home's first-run panel, so a new operator reads the
// same words whichever screen they are on.

import type { FirstRunSignal, FirstRunSignalState } from "@/lib/onboarding/first-run-signals"
import "./first-run-signals.css"

// The state word is rendered beside the label, so the row never depends on the dot's colour alone.
/** Above this many, the list collapses behind a disclosure instead of running down the panel. */
const ITEMS_INLINE_MAX = 3

const STATE_WORD: Record<FirstRunSignalState, string> = {
  ready: "Ready",
  working: "Working",
  empty: "Nothing found",
  unavailable: "Not available",
}

export default function FirstRunSignals({
  signals,
  ariaLabel = "What we have found so far",
}: {
  signals: FirstRunSignal[]
  ariaLabel?: string
}) {
  if (signals.length === 0) return null
  return (
    // aria-live so a signal landing is announced, polite so it never interrupts.
    <div className="frs" aria-label={ariaLabel} aria-live="polite">
      {signals.map((signal) => (
        <div className={`frs-row is-${signal.state}`} key={signal.key}>
          <span className="frs-mark" aria-hidden="true" />
          <div>
            <div className="frs-head">
              <span className="frs-label">{signal.label}</span>
              <span className="frs-state">{STATE_WORD[signal.state]}</span>
            </div>
            <p className="frs-line">{signal.headline}</p>
            {signal.items?.length ? (
              // ALT-654: a signal can now hand over its FULL list (local search returns every
              // ranked term with its position, which can be dozens). Above a short threshold it
              // collapses behind a native <details> so the panel stays short and the in-progress
              // rows below it stay high on the page, which was the point of the reordering.
              // <details> rather than a hand-rolled toggle: keyboard and screen-reader behaviour
              // come free, and it needs no client state.
              signal.items.length > ITEMS_INLINE_MAX ? (
                <details className="frs-more">
                  <summary>
                    All {signal.items.length} {signal.itemsNoun ?? "items"}
                  </summary>
                  <ul className="frs-items">
                    {signal.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              ) : (
                <ul className="frs-items">
                  {signal.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
