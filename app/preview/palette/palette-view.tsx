"use client"

// DEV/REVIEW-ONLY — the Ticket colour palette, read LIVE from the tokens.
//
// Every swatch resolves its value at runtime out of app/editorial-tokens.css rather than
// hardcoding hexes, so this page cannot drift from the single source of truth. Flip the
// theme toggle and every value, and every contrast ratio, recomputes.
//
// Contrast is CALCULATED (WCAG 2.1 relative luminance), not asserted, so the AA/AAA marks
// are trustworthy. Tokens carrying alpha are shown without a ratio, because contrast
// depends on what they are composited over.

import { useEffect, useState } from "react"
import "./palette.css"

type Tok = {
  name: string
  note?: string
  /** mark tokens that are aliases of another token, so the duplication is visible */
  alias?: string
}
type Group = { title: string; blurb?: string; tokens: Tok[]; kind: "surface" | "ink" | "family" | "line" | "raw" }

const GROUPS: Group[] = [
  {
    title: "Surfaces",
    kind: "surface",
    blurb: "Ground up. Each one is a real stacking level, not a shade choice.",
    tokens: [
      { name: "--paper", note: "app ground" },
      { name: "--paper-2", note: "recessed wells, tracks, hover" },
      { name: "--card", note: "elevated cards and panels" },
      { name: "--card-2", note: "nested surface inside a card" },
      { name: "--bond", note: "callout / secondary-button ground" },
      { name: "--thermal", note: "warm accent-adjacent wash" },
      { name: "--ledger", note: "muted fill", alias: "legacy" },
      { name: "--press", note: "deepest, for elevated-dark surfaces" },
    ],
  },
  {
    title: "Ink",
    kind: "ink",
    blurb: "The text hierarchy. Ratios are measured against --paper and --card.",
    tokens: [
      { name: "--ink", note: "primary text" },
      { name: "--ink-2", note: "body" },
      { name: "--ink-3", note: "secondary / meta" },
      { name: "--ash-2", note: "faint meta" },
      { name: "--print", alias: "--ink-2" },
      { name: "--ash", alias: "--ink-3" },
    ],
  },
  {
    title: "Rust",
    kind: "family",
    blurb: "The primary accent. Buttons, focus, links, the hero halo.",
    tokens: [
      { name: "--rust", note: "fill and large text" },
      { name: "--rust-2", note: "hover / gradient partner" },
      { name: "--rust-deep", note: "small text" },
      { name: "--rust-tint", note: "wash" },
    ],
  },
  {
    title: "Teal",
    kind: "family",
    blurb: "Confirmation and positive state. Kept, on-brief, the validation line.",
    tokens: [
      { name: "--teal" },
      { name: "--teal-2" },
      { name: "--teal-deep" },
      { name: "--teal-tint" },
      { name: "--clear", alias: "--teal" },
      { name: "--clear-2", alias: "--teal-deep" },
      { name: "--clear-wash", alias: "--teal-tint" },
    ],
  },
  {
    title: "Gold",
    kind: "family",
    blurb: "Caution. Reads as a warning, so it is deliberately absent from the insight card's score axes.",
    tokens: [
      { name: "--gold" },
      { name: "--gold-2" },
      { name: "--gold-deep" },
      { name: "--gold-tint" },
      { name: "--wire-gold", alias: "--gold" },
    ],
  },
  {
    title: "Slate",
    kind: "family",
    blurb: "The cool neutral accent. Timing tags on the insight card.",
    tokens: [
      { name: "--slate" },
      { name: "--slate-2" },
      { name: "--slate-deep" },
      { name: "--slate-tint" },
    ],
  },
  {
    title: "Alert",
    kind: "family",
    blurb: "Reserved. On the insight card it is the ONLY red, and only for the soonest timing tier.",
    tokens: [
      { name: "--alert" },
      { name: "--alert-2" },
      { name: "--alert-deep" },
      { name: "--alert-wash" },
    ],
  },
  {
    title: "Unfamilied",
    kind: "family",
    blurb: "One-off values that sit outside the base / -2 / -deep / -tint scale.",
    tokens: [{ name: "--signal", note: "flagged / attention" }],
  },
  {
    title: "Lines and halos",
    kind: "line",
    blurb: "Alpha-based, so no ratio: they depend on what they sit over.",
    tokens: [
      { name: "--line", note: "default border" },
      { name: "--line-2", note: "stronger border" },
      { name: "--rule", note: "divider" },
      { name: "--rule-strong", note: "page-header rule" },
      { name: "--halo-rust", note: "canvas gradient" },
      { name: "--halo-teal", note: "canvas gradient" },
      { name: "--halo-gold", note: "canvas gradient" },
    ],
  },
]

/* ── WCAG 2.1 relative luminance + contrast ─────────────────────────────── */
function parseRgb(v: string): [number, number, number, number] | null {
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}
function luminance([r, g, b]: [number, number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: string, b: string): number | null {
  const ca = parseRgb(a)
  const cb = parseRgb(b)
  if (!ca || !cb) return null
  // Alpha makes the ratio meaningless without knowing the backdrop.
  if (ca[3] < 1 || cb[3] < 1) return null
  const la = luminance(ca)
  const lb = luminance(cb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
function toHex(v: string): string {
  const c = parseRgb(v)
  if (!c) return v
  const h = (n: number) => n.toString(16).padStart(2, "0")
  const base = `#${h(c[0])}${h(c[1])}${h(c[2])}`.toUpperCase()
  return c[3] < 1 ? `${base} · ${Math.round(c[3] * 100)}%` : base
}

const ALL_TOKENS = GROUPS.flatMap((g) => g.tokens.map((t) => t.name))

/**
 * Ask the BROWSER what each token resolves to, inside the token scope, so the values
 * shown are exactly what the app renders rather than a second copy of the palette.
 */
function resolveTokens(): Record<string, string> | null {
  const host = document.querySelector(".pal-scope") as HTMLElement | null
  if (!host) return null
  const probe = document.createElement("span")
  probe.style.display = "none"
  host.appendChild(probe)
  const out: Record<string, string> = {}
  for (const name of ALL_TOKENS) {
    probe.style.color = ""
    probe.style.color = `var(${name})`
    out[name] = getComputedStyle(probe).color
  }
  probe.remove()
  return out
}

export default function PaletteView() {
  const [values, setValues] = useState<Record<string, string> | null>(null)

  // One effect. Every setState lives in an ASYNC callback (a timeout, or the observer),
  // never in the effect body, which is the repo's convention for this lint rule and also
  // what lets the first resolve happen after the stylesheet has painted.
  useEffect(() => {
    const read = () => setValues(resolveTokens())
    const t = setTimeout(read, 0)
    // The theme toggle swaps `.dark` on <html>, so re-resolve every value when it does.
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => {
      clearTimeout(t)
      obs.disconnect()
    }
  }, [])

  const paper = values?.["--paper"]
  const card = values?.["--card"]

  const ratioBadge = (v: string | undefined, bg: string | undefined, label: string) => {
    if (!v || !bg) return null
    const r = contrast(v, bg)
    if (r == null) return <span className="pal-ratio pal-ratio-na">{label} n/a</span>
    const rounded = r.toFixed(2)
    const grade = r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : "fail"
    return (
      <span className={`pal-ratio pal-ratio-${grade.split(" ")[0].toLowerCase()}`}>
        {label} {rounded} · {grade}
      </span>
    )
  }

  return (
    <div className="pal">
      {GROUPS.map((g) => (
        <section key={g.title} className="pal-group">
          <div className="pal-grouphead">
            <h2>{g.title}</h2>
            {g.blurb && <p>{g.blurb}</p>}
          </div>
          <div className="pal-swatches">
            {g.tokens.map((t) => {
              const v = values?.[t.name]
              const isInk = g.kind === "ink"
              return (
                <div key={t.name} className="pal-sw">
                  <div
                    className={`pal-chip ${g.kind === "line" ? "pal-chip-line" : ""}`}
                    style={{ background: `var(${t.name})` }}
                    aria-hidden="true"
                  />
                  <div className="pal-meta">
                    <code className="pal-name">{t.name}</code>
                    <span className="pal-val">{v ? toHex(v) : "…"}</span>
                    {t.alias && (
                      <span className="pal-alias">
                        {t.alias === "legacy" ? "legacy name" : `alias of ${t.alias}`}
                      </span>
                    )}
                    {t.note && <span className="pal-note">{t.note}</span>}
                    {isInk && (
                      <span className="pal-ratios">
                        {ratioBadge(v, paper, "on paper")}
                        {ratioBadge(v, card, "on card")}
                      </span>
                    )}
                    {g.kind === "family" && t.name.endsWith("-deep") && (
                      <span className="pal-ratios">{ratioBadge(v, card, "on card")}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
