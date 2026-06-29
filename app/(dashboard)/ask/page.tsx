// Ask — the answer-first anchor as an authed nav destination, REBUILT to Concept A
// "The Pass". The one-off question is LIVE (domain-locked, grounded via /api/ask).
// Batch 2: every ask persists to ask_history (rendered below), and a pinned STANDING
// question re-runs each morning after the brief precompute, its answer landing here +
// on the brief rail.
//
// This is a STRUCTURE rebuild (not a reskin): the page-title chrome (.pv-page /
// .pv-page-head) stays, but the BODY is re-authored to the kit — a hero-like ask
// surface, a standing-question management card, and a recent-asks section of cards
// with the product-wide TkConfidence encoding + honest "not in your data" framing.
//
// Server component: data fetching / types / business logic are UNCHANGED. The two
// interactive bits live in client islands inside this route folder (PassAskBox /
// PassStandingForm), mirroring the home/pass-play-card.tsx pattern, and reuse the
// SAME wired server flow (/api/ask + setStandingQuestion).

import type { CSSProperties } from "react"
import { resolveOperator } from "../operator-data"
import { loadRecentAsks, loadStandingAnswer, getStandingQuestion, type AskRecord } from "@/lib/ask/history"
import {
  TkCard,
  TkSoftPanel,
  TkSectionHead,
  TkConfidence,
  TkEmptyState,
  RevealOnView,
  type TkConfidenceLevel,
} from "@/components/ticket"
import PassAskBox from "./pass-ask-box"
import PassStandingForm from "./pass-standing-form"
import "./ask.css"

function fmtAskDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p")
}

// AskRecord confidence ("high"|"medium"|"low") → the kit's single confidence
// encoding. "low" reads as directional (1 pip, dashed).
function toLevel(c: AskRecord["confidence"]): TkConfidenceLevel {
  return c === "high" ? "high" : c === "medium" ? "medium" : "directional"
}

export default async function AskPage({
  searchParams,
}: {
  // ALT-183: the dashboard Ask widget (and its preloaded question chips) navigate here with
  // ?q=<question>; we read it server-side and hand it to the box as the initial question so it
  // prefills the input and auto-runs the answer on arrival.
  searchParams?: Promise<{ q?: string | string[] }>
}) {
  const sp = (await searchParams) ?? {}
  const qParam = Array.isArray(sp.q) ? sp.q[0] : sp.q
  const initialQuestion = qParam?.trim() ? qParam.trim() : undefined

  const op = await resolveOperator()
  const [recent, standingQuestion, standingAnswer] = await Promise.all([
    loadRecentAsks(op.locationId, 10),
    getStandingQuestion(op.locationId),
    loadStandingAnswer(op.locationId),
  ])

  const hasLiveStandingAnswer = !!(standingAnswer && standingAnswer.question === standingQuestion)

  return (
    <div className="pv-page">
      {/* page-title chrome — on-system, kept per the contract */}
      <div className="pv-page-head">
        <span className="pv-kicker">Ask Ticket</span>
        <h1 className="pv-h1">Ask anything about your market.</h1>
        <p className="pv-sub">Plain-language questions, answered only from your own market and competitor data, never the open web.</p>
      </div>
      <hr className="pv-rule" />

      {/* the page BODY is the kit */}
      <div className="tk-kit">
        {/* ── HERO ASK SURFACE + LIVE ANSWER (client island) ── */}
        <div style={{ marginTop: 28 }}>
          <PassAskBox
            locationId={op.locationId}
            locationName={op.locationName}
            standingQuestion={standingQuestion}
            initialQuestion={initialQuestion}
          />
        </div>

        {/* ── STANDING QUESTION ── */}
        <TkSectionHead title="Standing question" sub="Re-runs every morning with your brief" />
        <RevealOnView>
          <TkCard>
            <div className="tkask-standing">
              <div className="tkask-standing-top">
                <span className="tkask-standing-pin" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 17v5M9 10.8V4h6v6.8l2 3.2H7l2-3.2z" />
                  </svg>
                </span>
                <span className="tkask-standing-lbl">
                  {standingQuestion ? "Pinned · re-runs every morning" : "Pin one · re-runs every morning"}
                </span>
              </div>

              {standingQuestion ? (
                <>
                  <div className="tkask-standing-q">{standingQuestion}</div>
                  {hasLiveStandingAnswer && standingAnswer ? (
                    <>
                      <p className="tkask-standing-a">{standingAnswer.answer}</p>
                      <div className="tkask-ameta">
                        <TkConfidence level={toLevel(standingAnswer.confidence)} />
                        {standingAnswer.sources.length ? (
                          <span className="tkask-src"><b>From:</b> {standingAnswer.sources.join(" · ")}</span>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="tkask-standing-a">Pinned. The first answer lands here after tomorrow morning&apos;s brief.</p>
                  )}
                </>
              ) : (
                <>
                  <div className="tkask-standing-q">Who&apos;s undercutting me?</div>
                  <p className="tkask-standing-a">Pin a question like this and its answer will land here every morning, grounded in the same signals as your brief.</p>
                </>
              )}

              <PassStandingForm locationId={op.locationId} current={standingQuestion} />
            </div>
          </TkCard>
        </RevealOnView>

        {/* ── RECENT ASKS ── */}
        <TkSectionHead title="Recent asks" sub="Every question & answer, saved" />
        {recent.length ? (
          <RevealOnView className="tkask-recent" stagger>
            {recent.map((r, i) => (
              <div key={r.id} style={{ "--tk-i": i } as CSSProperties}>
                <TkSoftPanel className="tkask-rcard">
                  <div className="tkask-rmeta">
                    <span className={`tkask-rsource ${r.source === "standing" ? "tkask-rsource-standing" : "tkask-rsource-user"}`}>
                      {r.source === "standing" ? "Standing" : "You asked"}
                    </span>
                    <span>{fmtAskDate(r.createdAt)}</span>
                  </div>
                  <div className="tkask-rq">{r.question}</div>
                  <p className="tkask-ra">{r.answer}</p>
                  {(r.grounded || r.sources.length) ? (
                    <div className="tkask-rfoot">
                      {r.grounded ? (
                        <TkConfidence level={toLevel(r.confidence)} />
                      ) : (
                        <span className="tkask-ungrounded">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 8v5M12 16h.01" />
                          </svg>
                          Not in your data yet
                        </span>
                      )}
                      {r.sources.length ? (
                        <span className="tkask-src"><b>From:</b> {r.sources.join(" · ")}</span>
                      ) : null}
                    </div>
                  ) : null}
                </TkSoftPanel>
              </div>
            ))}
          </RevealOnView>
        ) : (
          <RevealOnView>
            <TkEmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.9.6-.9 1.1v.5" />
                  <path d="M11.8 16h.01" />
                </svg>
              }
              title="No asks yet"
              description="Every question and answer is saved here once you start asking. Try one of the suggestions above, or pin a standing question to get an answer every morning."
            />
          </RevealOnView>
        )}
      </div>
    </div>
  )
}
