"use client"

// Interactive Ask Ticket box: bounded NL question -> grounded, domain-locked answer
// from the location's own data (via /api/preview/ask). Shows confidence + the signals
// it used, and an honest "not in your data yet" when the answer isn't grounded.

import { useState } from "react"

type AskAnswer = { answer: string; confidence: "high" | "medium" | "low"; sources: string[]; grounded: boolean }

const SUGGESTED = [
  "Who's undercutting me right now?",
  "What changed this week?",
  "What should I prep before the weekend?",
  "Which competitor is gaining on social?",
]

export default function AskBox({ endpoint = "/api/ask" }: { endpoint?: string }) {
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
      <div className="pv-ask-input">
        <input
          type="text"
          value={q}
          placeholder="Ask about your market…"
          aria-label="Ask Ticket"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(q) }}
        />
        <button className="pv-btn pv-btn--sm" onClick={() => ask(q)} disabled={!q.trim() || loading}>
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>
      <div className="pv-chips">
        {SUGGESTED.map((s) => (
          <button className="pv-chip" key={s} onClick={() => ask(s)} disabled={loading}>{s}</button>
        ))}
      </div>

      {loading ? <div className="pv-ask-loading">Reading your market…</div> : null}

      {answer ? (
        <div className="pv-ask-answer">
          <div className="pv-ask-answer__q">{asked}</div>
          <p className="pv-ask-answer__a">{answer.answer}</p>
          <div className="pv-ask-answer__meta">
            <span className={`pv-pill ${answer.grounded ? "pv-pill--up" : "pv-pill--watch"}`}>
              {answer.grounded ? `Confidence · ${answer.confidence}` : "Not in your data yet"}
            </span>
            {answer.sources.length ? <span className="pv-ask-answer__src">From: {answer.sources.join(" · ")}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
