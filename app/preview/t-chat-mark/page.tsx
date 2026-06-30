// DEV/REVIEW-ONLY ideation harness — the "Ask Ticket about this" trigger reimagined
// as the Ticket T inside a chat bubble, in copper. Compares shapes/fills/shades and
// shows it at trigger size + on a real card next to the current icon. Prod-guarded.

import type { CSSProperties } from "react"
import { TicketChatMark } from "@/components/brand/ticket-chat-mark"
import { TicketLogo } from "@/components/brand/ticket-logo"
import "@/components/ticket/pass.css"

const cell: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  padding: "20px 16px",
  background: "var(--card)",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-md)",
}
const cap: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
}
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }
const rust: CSSProperties = { color: "var(--rust)" }

// The new trigger as it would render on a card corner (copper chat-bubble mark, no
// square container — the bubble IS the container).
function TriggerNew({ shape = "square" as "square" | "round", tint = false }) {
  return (
    <button
      type="button"
      aria-label="Ask Ticket about this"
      style={{
        position: "absolute",
        top: 9,
        right: 9,
        display: "grid",
        placeItems: "center",
        width: 28,
        height: 28,
        background: "none",
        border: 0,
        cursor: "pointer",
        color: "var(--rust)",
      }}
    >
      <TicketChatMark size={19} shape={shape} tint={tint} />
    </button>
  )
}

function SampleCard({ children, label, value }: { children: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ position: "relative", background: "var(--card)", border: "1px solid var(--line-2)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "16px 18px", minHeight: 92 }}>
      {children}
      <div style={{ fontFamily: "var(--font-cond)", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700, color: "var(--ink)", marginTop: 4 }}>{value}</div>
    </div>
  )
}

export default function TChatMarkPreview() {
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Ideation · Ask-Ticket trigger</span>
        <h1 className="pv-h1">Ticket T in a chat bubble</h1>
        <p className="pv-sub">
          The popover trigger, reimagined: the Ticket T inside a chat bubble (covers brand + “ask”), in copper.
          Outline and T both copper. Compare shapes, an optional tint fill, and the copper shade — then see it at
          trigger size and on a card next to today’s icon.
        </p>
      </div>
      <hr className="pv-rule" />

      <div className="tk-kit" style={{ marginTop: 24 }}>
        {/* ── The mark, large ── */}
        <div style={cap as CSSProperties}>The mark · copper outline</div>
        <div style={{ ...grid, marginTop: 10 }}>
          <div style={cell}><span style={rust}><TicketChatMark size={60} shape="square" /></span><span style={cap}>Square · outline</span></div>
          <div style={cell}><span style={rust}><TicketChatMark size={60} shape="round" /></span><span style={cap}>Round · outline</span></div>
          <div style={cell}><span style={rust}><TicketChatMark size={60} shape="square" tint /></span><span style={cap}>Square · tint</span></div>
          <div style={cell}><span style={rust}><TicketChatMark size={60} shape="round" tint /></span><span style={cap}>Round · tint</span></div>
        </div>

        {/* ── Copper shade ── */}
        <div style={cap as CSSProperties}>Copper shade</div>
        <div style={{ ...grid, gridTemplateColumns: "repeat(3, 1fr)", marginTop: 10 }}>
          <div style={cell}><span style={{ color: "var(--rust)" }}><TicketChatMark size={42} /></span><span style={cap}>--rust (signature copper)</span></div>
          <div style={cell}><span style={{ color: "var(--rust-deep)" }}><TicketChatMark size={42} /></span><span style={cap}>--rust-deep (darker)</span></div>
          <div style={cell}><span style={{ color: "var(--rust-2)" }}><TicketChatMark size={42} /></span><span style={cap}>--rust-2 (mid)</span></div>
        </div>

        {/* ── Before / after at trigger size ── */}
        <div style={cap as CSSProperties}>At trigger size (19px)</div>
        <div style={{ ...grid, gridTemplateColumns: "repeat(3, 1fr)", marginTop: 10 }}>
          <div style={cell}>
            <span style={{ display: "grid", placeItems: "center", width: 27, height: 27, borderRadius: 9, background: "color-mix(in srgb, var(--card) 84%, transparent)", border: "1px solid var(--line-2)", color: "var(--ink-3)", boxShadow: "var(--shadow-sm)" }}>
              <TicketLogo size={12} simplified />
            </span>
            <span style={cap}>Today (square container + T)</span>
          </div>
          <div style={cell}><span style={rust}><TicketChatMark size={19} shape="square" /></span><span style={cap}>New · square</span></div>
          <div style={cell}><span style={rust}><TicketChatMark size={19} shape="round" /></span><span style={cap}>New · round</span></div>
        </div>

        {/* ── On a card (as the real trigger) ── */}
        <div style={cap as CSSProperties}>On a card</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 10 }}>
          <SampleCard label="Avg high" value="72°F"><TriggerNew shape="square" /></SampleCard>
          <SampleCard label="Avg high" value="72°F"><TriggerNew shape="round" /></SampleCard>
          <SampleCard label="Avg high" value="72°F"><TriggerNew shape="square" tint /></SampleCard>
        </div>
      </div>
    </div>
  )
}
