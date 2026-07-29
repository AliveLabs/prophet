// The button + chip spec, rendered once per theme so both can be seen at once.
//
// Presentational and server-safe: hover and press are pure CSS, so no state is needed and
// what you see is exactly the shipped rule, not a simulation of it.
//
// Rendered inside `.ticket-app` for light and `.ticket-app.dark` for dark, which is how
// the token file scopes its two themes.

import "@/components/insights/unified-insight-card.css"

const BUTTONS: Array<{ tier: string; note: string; cls: string; label: string }> = [
  { tier: "Primary", note: "rust fill, --card label", cls: "uic-btn-primary", label: "See the plan" },
  { tier: "Secondary", note: "--ledger fill, --ink label", cls: "uic-btn-secondary", label: "See the plan" },
  { tier: "Tertiary", note: "no fill, --ink-2 label", cls: "uic-btn-tertiary", label: "Keep" },
  { tier: "Tertiary, danger", note: "colour on hover only", cls: "uic-btn-tertiary uic-btn-danger", label: "Dismiss" },
  { tier: "Toggle, frame two", note: "committed state", cls: "uic-btn-toggle-on", label: "Kept" },
]

// Same order the card renders them in: soonest first, so it leads the row.
const CHIPS: Array<{ axis: string; fill: string; cls: string; label: string }> = [
  { axis: "When, soonest", fill: "--alert-wash", cls: "uic-tag-urgent", label: "Next day or two" },
  { axis: "When", fill: "--teal-tint", cls: "uic-tag-when", label: "This week" },
  { axis: "What", fill: "--slate-tint", cls: "uic-tag-what", label: "Google Business Profile" },
  { axis: "State", fill: "--gold-tint", cls: "uic-tag-state", label: "On this week's brief" },
]

export default function ButtonChipSpec({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className={`ticket-app bcs${theme === "dark" ? " dark" : ""}`}>
      <div className="bcs-inner">
        <div className="bcs-head">
          {theme === "light" ? "Light" : "Dark"}
          <span>hover and press each one</span>
        </div>

        <div className="bcs-block">
          {BUTTONS.map((b) => (
            <div key={b.tier} className="bcs-row">
              <div className="bcs-label">
                <b>{b.tier}</b>
                <code>{b.note}</code>
              </div>
              <button type="button" className={`uic-btn ${b.cls}`}>{b.label}</button>
            </div>
          ))}
        </div>

        <div className="bcs-block">
          {CHIPS.map((c) => (
            <div key={c.axis} className="bcs-row">
              <div className="bcs-label">
                <b>{c.axis}</b>
                <code>{c.fill}</code>
              </div>
              <span className={`uic-tag ${c.cls}`}>{c.label}</span>
            </div>
          ))}
        </div>

        {/* All four chip fills, adjacent and unlabelled, which is the real test: can you
            tell them apart at a glance and does the soonest tier stand out. */}
        <div className="bcs-block">
          <div className="bcs-row">
            <div className="bcs-label"><b>Together</b><code>the glance test</code></div>
            <span className="bcs-chiprow">
              {CHIPS.map((c) => (
                <span key={c.axis} className={`uic-tag ${c.cls}`}>{c.label}</span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
