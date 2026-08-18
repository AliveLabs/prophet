"use client"

// The Pass — Ask Ticket box, rebuilt to the kit. The DATA FLOW for the question is
// unchanged from the original ask-box.tsx: a bounded NL question -> grounded answer
// from the location's own data OR the platform how-to KB (POST /api/ask routes by
// intent server-side). Presentation is the kit — a hero-like answer-first surface
// (big input + suggested-question CHIPS) and the answer in a TkCard with the
// product-wide TkConfidence pips + sources, the honest "not in your data yet" state,
// and a "Pin this" action that makes the question re-run every morning (ALT-205).

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { TkCard, TkConfidence, RevealOnView, type TkConfidenceLevel } from "@/components/ticket"
import { setStandingQuestion } from "./actions"

type AskAnswer = { answer: string; confidence: "high" | "medium" | "low"; sources: string[]; grounded: boolean }

// The HOW-TO prompt is instructional, so it's obvious Ask also helps you use the site, not just
// read your market (ALT-203a). `kind` gives it a quiet distinct treatment while it stays a
// clickable chip. It is always available: it needs no location data to answer.
//
// ALT-634: the MARKET questions now come from the caller, which knows what this location holds.
// The old hardcoded list led with "Who's undercutting me right now?", which Ask cannot ground —
// no menu or pricing data reaches gatherAskContext, so the chip dead-ended every time.
const HOWTO_SUGGESTION = {
  text: "How do I add a competitor's social handle?",
  kind: "howto" as const,
}

// AskAnswer confidence ("high"|"medium"|"low") → the kit's single confidence
// encoding ("high"|"medium"|"directional"). "low" reads as directional.
function toLevel(c: AskAnswer["confidence"]): TkConfidenceLevel {
  return c === "high" ? "high" : c === "medium" ? "medium" : "directional"
}

export default function PassAskBox({
  locationId,
  locationName,
  standingQuestion = null,
  initialQuestion,
  endpoint = "/api/ask",
  suggested = [],
}: {
  locationId: string
  locationName: string
  /** ALT-634: market questions this location's data can actually answer. The how-to chip is
   *  appended locally because it needs no location data. */
  suggested?: readonly string[]
  /** the currently pinned standing question, if any (to reflect "Pinned" state) */
  standingQuestion?: string | null
  /** ALT-183: a question carried in from the dashboard Ask widget (via ?q=). When present we
   *  prefill the input and auto-run the answer once on arrival so the page lands already answering. */
  initialQuestion?: string
  endpoint?: string
}) {
  const suggestions = [
    ...suggested.map((text) => ({ text, kind: "market" as const })),
    HOWTO_SUGGESTION,
  ]
  const router = useRouter()
  const [q, setQ] = useState(initialQuestion ?? "")
  const [asked, setAsked] = useState("")
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [pinning, startPin] = useTransition()
  const [pinnedThis, setPinnedThis] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  // ALT-183: auto-run the carried-in question exactly once on mount. Guarded by a ref so a
  // re-render (e.g. from router.refresh on pin) never re-fires it.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    const seed = initialQuestion?.trim()
    if (!seed) return
    autoRan.current = true
    void ask(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function ask(question: string) {
    const qq = question.trim()
    if (!qq || loading) return
    setQ(qq)
    setAsked(qq)
    setLoading(true)
    setAnswer(null)
    setPinnedThis(false)
    setPinError(null)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: qq }),
      })
      setAnswer((await res.json()) as AskAnswer)
      // ALT-667: "Recent asks" is server-rendered from lib/ask/history.ts, so without a
      // refresh it keeps showing whatever it held at first paint and the question the
      // operator just asked looks lost. Only on success: a failed ask wrote no history.
      // Safe against re-running the carried-in question, which the ALT-183 `autoRan` ref
      // already guards for exactly this reason, and the answer lives in client state so
      // refreshing the server tree will not clear what they are reading.
      router.refresh()
    } catch {
      setAnswer({ answer: "Something went wrong. Try again in a moment.", confidence: "low", sources: [], grounded: false })
    } finally {
      setLoading(false)
    }
  }

  // ALT-205a: pin the asked question as the standing question (re-runs each morning).
  // Reuses the same wired server action as the standing form; refresh so it appears in
  // the Standing question card here and on the Today brief.
  function pinThis() {
    if (!asked.trim() || pinning) return
    setPinError(null)
    startPin(async () => {
      const res = await setStandingQuestion(locationId, asked.trim())
      if (!res.ok) setPinError(res.error ?? "Couldn't pin — try again.")
      else {
        setPinnedThis(true)
        router.refresh()
      }
    })
  }

  const alreadyStanding = !!asked && standingQuestion?.trim() === asked.trim()
  const isPinned = pinnedThis || alreadyStanding

  return (
    <div>
      {/* ── HERO ASK SURFACE ── */}
      <RevealOnView>
        <TkCard className="tkask-hero">
          <div className="tkask-prompt">What do you want to know?</div>

          <div className="tkask-field">
            <input
              className="tkask-input"
              type="text"
              value={q}
              placeholder="Ask about your market…"
              aria-label="Ask Ticket a question about your market"
              enterKeyHint="search"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(q) }}
            />
            <button
              className="tkask-send"
              onClick={() => ask(q)}
              disabled={!q.trim() || loading}
              aria-label="Ask Ticket"
            >
              {loading ? "Asking…" : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                  Ask
                </>
              )}
            </button>
          </div>

          <div className="tkask-suggest">
            {suggestions.map((s) => (
              <button
                className={`tkask-sg${s.kind === "howto" ? " tkask-sg-howto" : ""}`}
                key={s.text}
                onClick={() => ask(s.text)}
                disabled={loading}
                type="button"
              >
                {s.kind === "howto" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.9.6-.9 1.1v.5M11.8 16h.01" />
                  </svg>
                ) : null}
                {s.text}
              </button>
            ))}
          </div>

          {/* ALT-204: market-only message kept; internal "domain-locked / cost-controlled"
              labels removed; a help line added so operators know Ask also helps with the site. */}
          <p className="tkask-foot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Answers come only from {locationName}&apos;s market &amp; competitor data, never the open web. Ask can also help with how to use the site.
          </p>
        </TkCard>
      </RevealOnView>

      {/* ── THINKING STATE ── */}
      {loading ? (
        <div className="tkask-thinking" role="status" aria-live="polite">
          <span className="tkask-pulse" aria-hidden="true" />
          Reading your market…
        </div>
      ) : null}

      {/* ── ANSWER CARD ── */}
      {answer && !loading ? (
        <RevealOnView style={{ marginTop: 18 }}>
          <TkCard className="tkask-answer-card">
            <div className="tkask-answer">
              <div className="tkask-aq">{asked}</div>
              <p className="tkask-aa">{answer.answer}</p>
              <div className="tkask-ameta">
                {answer.grounded ? (
                  <TkConfidence level={toLevel(answer.confidence)} />
                ) : (
                  <span className="tkask-ungrounded">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v5M12 16h.01" />
                    </svg>
                    Not in your data yet
                  </span>
                )}
                {answer.sources.length ? (
                  <span className="tkask-src">
                    <b>From:</b> {answer.sources.join(" · ")}
                  </span>
                ) : null}

                {/* ALT-205a: pin this Q&A so it re-runs every morning with the brief */}
                <button
                  className={`tkask-pin${isPinned ? " tkask-pin-on" : ""}`}
                  type="button"
                  onClick={pinThis}
                  disabled={pinning || isPinned}
                  aria-pressed={isPinned}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 17v5M9 10.8V4h6v6.8l2 3.2H7l2-3.2z" />
                  </svg>
                  {isPinned ? "Pinned · re-runs each morning" : pinning ? "Pinning…" : "Pin this"}
                </button>
              </div>
              {pinError ? <p className="tkask-form-error" role="alert">{pinError}</p> : null}
            </div>
          </TkCard>
        </RevealOnView>
      ) : null}
    </div>
  )
}
