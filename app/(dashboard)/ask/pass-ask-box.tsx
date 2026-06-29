"use client"

// The Pass — Ask Ticket box, rebuilt to the kit. The DATA FLOW is unchanged from
// the original ask-box.tsx: a bounded NL question -> grounded, domain-locked answer
// from the location's own data (POST /api/ask). Only the PRESENTATION is rebuilt —
// a hero-like answer-first surface (big input + suggested-question chips) and the
// answer rendered in a TkCard with the product-wide TkConfidence pips + sources, plus
// the honest "not in your data yet" state when the answer isn't grounded.

import { useState } from "react"
import { TkCard, TkConfidence, RevealOnView, type TkConfidenceLevel } from "@/components/ticket"

type AskAnswer = { answer: string; confidence: "high" | "medium" | "low"; sources: string[]; grounded: boolean }

const SUGGESTED = [
  "Who's undercutting me right now?",
  "What changed this week?",
  "What should I prep before the weekend?",
  "Which competitor is gaining on social?",
]

// AskAnswer confidence ("high"|"medium"|"low") → the kit's single confidence
// encoding ("high"|"medium"|"directional"). "low" reads as directional.
function toLevel(c: AskAnswer["confidence"]): TkConfidenceLevel {
  return c === "high" ? "high" : c === "medium" ? "medium" : "directional"
}

export default function PassAskBox({
  locationName,
  endpoint = "/api/ask",
}: {
  locationName: string
  endpoint?: string
}) {
  const [q, setQ] = useState("")
  const [asked, setAsked] = useState("")
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)

  async function ask(question: string) {
    const qq = question.trim()
    if (!qq || loading) return
    setQ(qq)
    setAsked(qq)
    setLoading(true)
    setAnswer(null)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: qq }),
      })
      setAnswer((await res.json()) as AskAnswer)
    } catch {
      setAnswer({ answer: "Something went wrong. Try again in a moment.", confidence: "low", sources: [], grounded: false })
    } finally {
      setLoading(false)
    }
  }

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
            {SUGGESTED.map((s) => (
              <button className="tkask-sg" key={s} onClick={() => ask(s)} disabled={loading} type="button">
                {s}
              </button>
            ))}
          </div>

          <p className="tkask-foot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Domain-locked · answers come only from {locationName}&apos;s market &amp; competitor data, never the open web · cost-controlled
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
              </div>
            </div>
          </TkCard>
        </RevealOnView>
      ) : null}
    </div>
  )
}
