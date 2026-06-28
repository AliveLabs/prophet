# THE PASS — Ticket app design system (premium light + dimensional)

> Built 2026-06-28 on branch `redesign/the-pass`. Base = round-2 Concept **A "The Pass"**, grafting
> Concept **C** gradients, Concept **B** inline entity-management, Concept **D** soft-panel/canvas instinct,
> and the Dribbble pearlescent-canvas technique (in Ticket hues).
>
> **This doc is the contract.** Every page/component must read as one product. Do not invent new colors,
> shadows, radii, or motion — use the tokens here. If a token is missing, add it HERE first, then use it.
>
> **Why we're here:** the app shipped a flat *newsprint/editorial* skin (cream + Instrument Serif + hairlines
> as whole-app chrome) — an AI-design cliché and the opposite of premium software. The fix is **depth**
> (gradient canvas, soft elevation, real negative space, motion, confident color), staying **LIGHT**, not dark.
> See `docs/design-gap-diagnosis-2026-06-26.md`.

---

## 0. The four non-negotiables

1. **Premium light + dimensional.** Light grounds, but with an atmospheric gradient **canvas**, soft elevation,
   generous negative space, and motion. Never flat. Never newsprint. Dark mode is a true peer (§7).
2. **One palette, two token layers.** The app has two CSS systems (editorial `.pv-*` and Tailwind-semantic).
   Both are mapped to the SAME palette below (§1–§2). A page looks identical in spirit regardless of which it uses.
3. **Mobile is first-class, not a shrink.** Every task is doable on mobile; it should feel like a native app
   (bottom tab bar, sheets, large tap targets, safe-area aware). Tablet is a deliberate size, not a stretched phone.
4. **Motion = "alive & smart."** Meaningful micro-interactions everywhere they add value or signal the system is
   working (data animating in, live pulses, hover lift, ambient canvas drift). Always honor `prefers-reduced-motion`.

---

## 1. Palette (the durable core)

Warm, confident, durable. Mid-tone brand colors are **fills/large display only**; their `-deep` variants are
for **small text** (AA — §8). Light values first; dark values in §7.

### Brand families (each: base / deep / tint)
| Family | base (fill, large) | deep (small text) | tint (wash bg) | Meaning |
|---|---|---|---|---|
| **Rust** (signature) | `#B85C38` | `#8A3D20` | `#F4E2D7` | primary action, "capitalize", brand thread |
| **Teal / Clear** | `#3A8066` | `#2E6B54` | `#DCEBE3` | success, "yours", up, confirmed |
| **Gold / Wire** | `#C9942A` | `#856017` | `#F4E8CC` | watch, attention, medium-confidence |
| **Slate** | `#3D4F5F` | `#2C3A47` | `#E0E6EB` | links, "prepare", cool counterweight, info |
| **Alert** | `#C44040` | `#A83232` | `#F6DCDA` | threat, down, destructive |

### Neutrals & surfaces (light)
| Token | Hex | Use |
|---|---|---|
| `--paper` | `#FAF8F4` | app ground (warmer + lighter than old newsprint) |
| `--paper-2` | `#F3EFE8` | recessed wells, track backgrounds, hover |
| `--card` | `#FFFFFF` | elevated cards, panels |
| `--card-2` | `#FBF9F5` | nested surface inside a card |
| `--bond` | `#F4EFE8` | callout / secondary button bg |
| `--thermal` | `#FBF0E6` | warm rust-adjacent wash (recommended tier, copy blocks) |
| `--line` | `#E9E2D7` | hairline borders, dividers |
| `--line-2` | `#DAD2C4` | stronger border (card edges, inputs) |
| `--ink` | `#241E1A` | primary text, near-black warm |
| `--ink-2` | `#5C5249` | body text |
| `--ink-3` | `#756A5D` | secondary/meta text (large or sparing — §8) |

### The canvas (prominent background element — Bryan constraint #3)
Atmospheric, soft, multi-hue radial gradients fixed behind the app. This is what makes "light" feel premium.
```
--halo-rust: rgba(184,92,56,.10);
--halo-teal: rgba(58,128,102,.10);
--halo-gold: rgba(201,148,42,.07);
```
`.bg-atmos` (fixed, z-index:-1) layers 3–4 large radial gradients from these halos + a very slow ambient drift
(§4). Onboarding/auth/hero moments use a **richer pearlescent** version (§6 / Dribbble technique).

---

## 2. Token mapping — keep names, upgrade values

Two files are the SSOT. **Do not change class names** in markup; change the tokens/rules these files own.

### A. `app/editorial-tokens.css` — drives `.pv-*`, `.ticket-brief`, `.ticket-app`, `.ob`
Keep every existing token name (`--paper --ink --rust --ash --rule --bond --thermal --card --slate --clear`,
fonts, `--shadow-chit`, `--radius-card`) so all current rules keep resolving — but upgrade their VALUES to §1
and ADD the new families/tints/shadows/radii/motion tokens. Mapping of legacy → new:
- `--ash` → `--ink-3` value; `--ash-2` → a lighter meta; `--print` → `--ink-2`.
- `--clear`/`--clear-wash` → teal/teal-tint. `--wire-gold`/`--gold-deep` → gold/gold-deep.
- `--rule` stays a hairline but slightly warmer; add `--rule-strong`.
- `--radius-card` grows `6px → 16px` (soft, premium). Add `--r-sm 10 / --r-md 16 / --r-lg 22 / --r-xl 28`.
- `--shadow-chit` → soft `--shadow-sm`; add `--shadow-md`, `--shadow-lg`, `--shadow-lift`.

### B. `app/ticket-theme.css` `[data-brand="ticket"]` + `app/globals.css` — drives Tailwind utilities
Re-point the shadcn-convention semantic tokens to the SAME palette so `bg-card`/`text-foreground`/`border-border`
pages match:
- `--background` → `--paper`; `--foreground` → `--ink`; `--card` → `#FFFFFF`; `--card-foreground` → `--ink`
- `--primary` → `--rust` (CTAs are rust now, not slate); `--primary-foreground` → `#fff`
- `--secondary`/`--muted` → `--paper-2`/`--bond`; `--muted-foreground` → `--ink-3`
- `--accent` → `--rust`; `--border`/`--input` → `--line`/`--line-2`; `--ring` → `--rust`
- `--radius` → `0.9rem` (≈16px). Keep the glow-shadow tokens; re-point glow colors to rust/teal/gold.
- Upgrade the named extended palette (`--ticket-*`, `--forge-*`) to §1 values so legacy utility classes match.

### Fonts (already loaded in `app/layout.tsx` via next/font — just re-point tokens)
| Token | New value | Role |
|---|---|---|
| `--font-display` / `--font-cond` | **Space Grotesk** (`--font-space-grotesk`) | headings, section heads, labels (uppercase+tracked for labels) |
| `--font-sans` | **Inter** (`--font-inter`) | body, UI |
| `--font-mono` | **Space Mono** (`--font-space-mono`) | data, stats, overlines, "terminal" micro-labels |
| `--font-editorial` (NEW) | **Fraunces** (`--font-fraunces`), italic | RARE flourish: the daily-brief lead headline ONLY |

Retire Instrument Serif + Barlow Condensed from use (leave loaded; remove later as perf cleanup). Display
headings use weight **600–700** with tracking `-0.02em` (not the old serif weight 400).

---

## 3. Elevation & surface language

- **Resting card:** `--card`, `1px solid --line-2`, `--radius-lg` (22px) or `--radius-card` (16px), `--shadow-sm`.
- **Hover/raised:** `translateY(-2px)` + `--shadow-md` (cards that are clickable).
- **Hero / lead / modal / drawer:** `--shadow-lg` / `--shadow-lift`, `--radius-xl`.
- **Soft contained panel** (Concept D middle path): `--card-2` or `--bond` bg, `1px --line`, NO heavy shadow —
  for grouping inside a card without over-chroming. Prefer this over nested lifted cards.
- **Glass** (sticky chrome only): `background: color-mix(in srgb, var(--paper) 82%, transparent)` +
  `backdrop-filter: saturate(140%) blur(12px)`. Used on topbar, mobile tab bar, drawer header.
- **Gradient fills** (Concept C): `linear-gradient(150deg, base, deep)` for primary buttons, brand mark, weighted
  widgets, hero veils. Text/number "weight" widgets get the gradient; data-display widgets stay `--card`.
- Shadows: `sm 0 1px 2px / 0 1px 3px (.05–.06)`, `md 0 4px 14px / 0 2px 6px (.08)`, `lg 0 18px 50px / 0 6px 18px (.16/.08)`. Warm-shifted (`rgba(36,30,26,…)`).

---

## 4. Motion & micro-interaction catalog

Tokens: `--t-fast .16s`, `--t .28s`, `--t-slow .5s`, `--ease cubic-bezier(.22,.61,.36,1)`.
Keyframes live in `globals.css` (extend, don't duplicate). **Everything below must no-op under
`prefers-reduced-motion: reduce`.**

| Interaction | Where | Spec |
|---|---|---|
| **Entrance fade-up (stagger)** | page/section/card mount | `fade-up 320ms --ease`, 40–60ms stagger per item |
| **Card hover lift** | any clickable card | `translateY(-2px)` + shadow-sm→md, `--t-fast` |
| **Button press** | all buttons | hover `translateY(-1.5px)`+shadow; active `translateY(0)` |
| **Data reveal** | bars, rangebars, sentiment, meters | animate `width`/`height` 0→value `1s --ease` on in-view |
| **Counter count-up** | big stat numbers | count from 0 → value ~900ms on in-view (mono, tabular-nums) |
| **Live pulse** | live data / pipeline running / fresh badge | `pulse-dot 2s` dot; signal dot 1.5s |
| **Ambient canvas drift** | `.bg-atmos` | very slow (`~40s`) background-position drift — the "alive at rest" cue |
| **Confidence reveal** | conf pips/meter | pips fill left→right on mount |
| **Drawer / sheet** | detail, mobile actions | slide-in `--t --ease` + scrim fade |
| **Accordion** | drill / "why" / "N more" | `grid-template-rows 0fr→1fr` transition (no JS height math) |
| **Toast** | confirmations | slide-up + `success-pop` on the icon |
| **Skeleton shimmer** | loading | existing `.skeleton` shimmer |
| **Nav active** | sidebar/tab | active indicator slides/grows; rust tick |

Principle: motion communicates *state and freshness* (this tool is live and working), never decoration for its
own sake. When in doubt, subtle + fast.

---

## 5. Component patterns (the kit)

Restyle the shared primitives once; pages inherit. Source HTML reference: `docs/design-concepts/round2/A-the-pass-refined.html`.

- **Buttons:** primary = rust gradient + shadow-sm, hover lift; secondary = `--card` + `--line-2` border;
  ghost = transparent; destructive = alert. Min height **44px** (touch). `--radius` 11px.
- **Chips / tags:** pill, family-tinted bg + `-deep` text (e.g. `.chip-menu` = teal-tint/teal-deep).
- **Confidence:** ONE encoding product-wide — segmented pips/meter (High = 3 filled teal, Med = 2 gold,
  Directional = 1 + dashed/low-emphasis). Every confidence expands one-tap to its sources ("why"). Directional
  must look clearly lower-emphasis (never like High).
- **Cards:** play/move card, stat card, soft panel, list row. See §3.
- **Hero:** 2-col (photo/gradient canvas + body), stacks on mobile (photo first). `--radius-xl`, `--shadow-lg`.
- **Weighted widgets:** Concept A grid (`repeat(4,1fr)`, `w-wide span 2`, `w-tall span 2`); gradient tiles for
  weight, `--card` tiles for data. 2-col at ≤980, 1-col at ≤460.
- **Data viz:** rangebar, sentiment rows, directional grid, numbig counter, head-to-head bars, social embed,
  quote block — all from Concept A, all animate in (§4).
- **Drawer / sheet:** right-slide on desktop, bottom-sheet on mobile; scrim; sticky header w/ glass.
- **Toast / tooltip:** ink bg, paper text, rust/gold accent value.
- **Forms:** inputs `--card` bg, `--line-2` border, focus ring rust; 44px min; labels in mono/grotesk overline.
- **Empty / first-run / "still learning" states:** every trend/position view needs a "still reading your block —
  N days in" state with the `.sweep` animation (never an empty/broken chart). UX-gap requirement.

---

## 6. Onboarding / auth / secondary surfaces (Dribbble-influenced)

Refs saved in scratchpad (`dribbble-1/2/3.png`). Translate the *technique* into Ticket hues:
- **Pearlescent multi-hue canvas:** large soft radial gradients (rust → gold → teal → slate, very desaturated,
  low-opacity) bottom/corner glow over `--paper`. The most prominent canvas use in the app.
- **Floating soft-shadow panels:** big radius (24–28px), `--shadow-lg`, lots of surrounding negative space.
- **Big display headings** (Space Grotesk 600; a Fraunces flourish allowed here), short muted subtext.
- **Dark pill CTAs** (`--ink` bg) or rust-gradient primary.
- **Split layout** desktop (canvas/illustration left, form/cards right); single column mobile.
- Apply the same treatment to: payment/upgrade dialogs, settings sheets, plan-picker, success moments.

---

## 7. Dark mode (a true peer, not an afterthought)

Warm dark (not cold gray). Under `.dark` (ThemeProvider) for BOTH token layers.
| Token | Dark value |
|---|---|
| `--paper / --paper-2` | `#161310` / `#1D1916` |
| `--card / --card-2` | `#221D19` / `#1B1714` |
| `--line / --line-2` | `#332B24` / `#42372E` |
| `--ink / --ink-2 / --ink-3` | `#F3ECE3` / `#C3B8AB` / `#9C9082` |
| Rust / Teal / Gold / Slate / Alert | `#D67A52` / `#5FB48E` / `#E0B14B` / `#9DB1C0` / `#E76A6A` (lightened) |
| Halos | rust `.16`, teal `.14`, gold `.10` (brighter) |
| Shadows | deeper, black-based (`rgba(0,0,0,.4–.6)`) |
Tints in dark become deep low-chroma backgrounds (e.g. rust-tint `#3A271E`). Gradient fills keep base→deep.
Test every screen in both themes.

---

## 8. Accessibility (AA minimum — Bryan)

- Target **WCAG AA**: 4.5:1 normal text, 3:1 large text (≥24px or ≥19px bold) and UI/graphics.
- **Rule:** mid-tone brand colors (rust `#B85C38`, gold `#C9942A`) **fail AA as small text on white** — use them
  for fills/borders/large display only; use `-deep` (`#8A3D20`, `#856017`) for small text. Slate/teal-deep pass.
- `--ink-3` (`#756A5D`) on `--paper` is ~AA borderline — use for ≥14px/secondary, not long body.
- Visible focus ring (rust, 2.5px, offset) on all interactive elements. Tap targets ≥44px.
- Don't encode meaning by color alone (pair with icon/label/shape — e.g. confidence pips + word).
- **If you must ship a knowing AA violation, flag it inline in code + note it; don't block the work.**

---

## 9. Responsive / breakpoints

- **Mobile-first.** Build the phone layout, then enhance up. Bottom tab bar replaces sidebar < `md`. Right-drawer
  becomes bottom-sheet. Sticky glass header. Safe-area insets (`env(safe-area-inset-*)`).
- Breakpoints (match Concept A): `≤460` 1-col widgets; `≤760` mobile (hide desktop topnav, 1-col grid, show tab
  bar); `≤980` hero stacks + 2-col widgets; `≤1160` brief rail goes static; `--maxw 1180px` content cap.
- **Tablet (~768–1024):** deliberate 2-col, larger tap targets than desktop, sidebar may be icon-rail. Not a
  stretched phone, not a cramped desktop.
- **Mobile parity:** every action (manage competitors/handles, settings, billing, switch location, dismiss w/
  reason, ask) must be reachable and completable on mobile.

---

## 10. UX gaps to close while applying (from `docs/ux-gaps-tracker.md`)
- **Manage watched entities** (THE big one): add/change/remove own + competitors' social handles + trigger
  discovery. Home it on the Competitors header + Ask box + empty-state CTAs on any social card.
- **Per-handle provenance:** verified / discovering / not-found badge per handle/network.
- **Confidence "why"** on every card; **Directional** visibly lower-emphasis.
- **Dismiss captures a reason** (+ undo / "why shown").
- **First-run / "still learning"** states for trend/position views.

---

## 11. File-by-file map (where the work lands)
| Layer | Files |
|---|---|
| Tokens (editorial) | `app/editorial-tokens.css` |
| Tokens (tailwind/forge) | `app/ticket-theme.css`, `app/globals.css` |
| Motion keyframes/utils | `app/globals.css` |
| Shell + chrome + pv-pages | `app/(dashboard)/operator.css`, `shell-nav.tsx`, `account-menu.tsx`, layout |
| Flagship brief | `app/(dashboard)/home/brief.css`, `brief-view.tsx` |
| Mobile tab bar | `components/ui/bottom-nav.tsx` (rewire into dashboard shell) |
| Shared primitives | `components/ui/{button,card,panel,badge,input,topbar,tab-bar,theme-toggle}.tsx` |
| Onboarding/auth | `app/onboarding/onboarding.css`, onboarding/auth pages |
| Atmospheric canvas | new `.bg-atmos` element in dashboard + auth/onboarding layouts |

**Apply-agent rule:** edit only your assigned page's JSX + page-scoped style blocks. NEVER edit the shared token
files (§2) or shared primitives — those are owned centrally. If your page needs a new token/utility, request it.
Verify gate (`tsc` + `test:unit` + `next build`) and commits are run centrally, not by apply-agents.
