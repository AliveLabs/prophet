// DEV/REVIEW-ONLY harness for ALT-241 — the competitor "sonar" motif. Shows the
// animated radar (the login status block) at a few sizes and the static scope as
// the Competitors nav icon, inside the preview layout's `.ticket-app` token
// surface (so the teal/rust/gold tokens resolve). Prod-guarded by the preview
// layout (VERCEL_ENV !== production). Toggle the layout's `.dark` to check dark.

import { TkSonar, TkRule } from "@/components/ticket"
import "@/components/ticket/pass.css"

// The same static scope inlined into sidebar-nav / bottom-nav, at the nav's 15px box.
const NAV_SONAR = (
  <svg width="22" height="22" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="7.5" cy="7.5" r="6.2" />
    <line x1="7.5" y1="7.5" x2="11.9" y2="3.1" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="10.4" cy="4.5" r="0.95" fill="currentColor" stroke="none" />
    <circle cx="4.7" cy="9.2" r="0.95" fill="currentColor" stroke="none" />
    <circle cx="7.5" cy="7.5" r="1.05" fill="currentColor" stroke="none" />
  </svg>
)

const head: React.CSSProperties = {
  fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, color: "var(--ink-3)",
  letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 12,
}

export default function SonarPreview() {
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">ALT-241</span>
        <h1 className="pv-h1">Competitor sonar</h1>
        <p className="pv-sub">
          One motif: the animated radar for the login status block, and the same scope as the
          Competitors nav icon. Teal scan, rust you, gold competitor blips — all design tokens.
        </p>
      </div>
      <TkRule />

      <div className="tk-kit" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        {/* ── Login status block ── */}
        <div>
          <div style={head}>Login · status block</div>
          <div
            style={{
              display: "inline-flex", alignItems: "center", gap: 12, padding: "12px 15px",
              border: "1px solid var(--line)", borderRadius: "var(--r-md)",
              background: "color-mix(in srgb, var(--card) 78%, transparent)", boxShadow: "var(--shadow-md)",
            }}
          >
            <TkSonar size={46} />
            <span style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.2 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-3)" }}>Status</span>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5, color: "var(--ink)" }}>Watching your competitors</span>
            </span>
          </div>
        </div>

        {/* ── Sonar at sizes ── */}
        <div>
          <div style={head}>Sonar · scales</div>
          <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
            <TkSonar size={140} />
            <TkSonar size={88} />
            <TkSonar size={46} />
          </div>
        </div>

        {/* ── Nav icon ── */}
        <div>
          <div style={head}>Competitors nav icon · 15px box</div>
          <div style={{ width: 220, padding: 10, border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 8, color: "var(--ink-3)" }}>
              <span style={{ width: 15, height: 15, opacity: 0.65 }}>{NAV_SONAR}</span>
              <span style={{ fontSize: 13.5 }}>Insights</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 8, color: "var(--rust)", background: "color-mix(in srgb, var(--rust) 10%, transparent)", fontWeight: 500 }}>
              <span style={{ width: 15, height: 15 }}>{NAV_SONAR}</span>
              <span style={{ fontSize: 13.5 }}>Competitors</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
