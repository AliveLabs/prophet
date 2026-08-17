"use client"

// ALT-183 — the dashboard Ask widget (credibility-rail card).
//
// Was: every element (field + chips) was a plain link that navigated to /ask on ANY click.
// Now: a REAL input the operator can type into in place. Only on Enter (or the inline submit
// arrow) do we navigate to /ask, carrying the typed text as ?q=<question>; the Ask page reads
// it, prefills the input, and auto-runs the answer. The preloaded question CHIPS navigate the
// same way with their question pre-filled so the answer starts rendering on arrival.
//
// This is the interactive island that replaces the static markup that used to live inline in
// the (server) brief-view. The preview/read-only surface stays non-interactive and is rendered
// by the server component, never this client island, so no navigation fires in a preview.

import { useState } from "react"
import { useRouter } from "next/navigation"

// ALT-634: the chips are handed in by the server, which knows what this location holds. They
// used to be hardcoded here and led with "Who's undercutting me?", a question Ask has no menu or
// pricing data to answer. An offered question is a promise.
export function PassAskWidget({ questions = [] }: { questions?: readonly string[] }) {
  const router = useRouter()
  const [q, setQ] = useState("")

  function go(question: string) {
    const qq = question.trim()
    // empty input → just open Ask (no auto-run); typed/chip → carry the question
    router.push(qq ? `/ask?q=${encodeURIComponent(qq)}` : "/ask")
  }

  return (
    <>
      <form
        className="pass-ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          go(q)
        }}
      >
        <input
          type="text"
          className="pass-ask-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about your market…"
          aria-label="Ask Ticket a question about your market"
          enterKeyHint="search"
        />
        <button type="submit" className="pass-ask-go" aria-label="Ask Ticket">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      <div className="pass-ask-chips">
        {questions.map((c) => (
          <button key={c} type="button" className="pass-ask-chip" onClick={() => go(c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="pass-ask-foot">
        Domain-locked. Answers come only from your market and competitor data, never the open web.
      </p>
    </>
  )
}
