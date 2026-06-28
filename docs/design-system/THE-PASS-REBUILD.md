# THE PASS — REBUILD CONTRACT (2026-06-28, session 2)

> This is the binding contract for the **second** implementation of Concept A "The Pass". The first
> implementation (PR #37, now on `main`) was **rejected**: it kept the old `.pv-*` / `.ticket-brief`
> editorial markup and only swapped CSS-variable VALUES + fonts + bolted on dark. Result: "still looks
> like prod in layout, form, and function." **We are NOT doing that again.**
>
> Source of truth for the look: `docs/design-concepts/round2/A-the-pass-refined.html` (open it).
> Token SSOT (already correct, Ticket-anchored, premium-light + warm-dark): `app/editorial-tokens.css`
> (the `--paper/--rust/--card/--shadow-*/--r-*/--t-*` layer) and `app/ticket-theme.css`
> (`[data-brand="ticket"]` Tailwind/shadcn semantic layer).

## 0. THE ONE RULE
**Rebuild STRUCTURE, not skin.** Every screen must be re-authored to Concept A's component patterns.
If a page's rebuilt JSX still has the same element/section structure as before with new class names, it
is WRONG. The test: open the page next to Concept A — it must read as the same product. If it reads as
the old card-list with nicer colors, start over.

Anti-patterns that mean you're failing (these are exactly what got rejected):
- Keeping `.pv-card` / `.movecard` / `.pv-page` skeletons and recoloring them.
- "Upgrading token values" instead of changing markup.
- A data page that's a vertical stack of bordered rows when Concept A shows a hero + widget grid + viz.

## 1. Hard constraints (Bryan, this session)
1. **Light is the default** (already set: `theme-provider.tsx` → `defaultTheme="light"`, `enableSystem=false`).
   Dark is a **user-chosen** preference via a switcher mounted in the operator shell. Never default to dark/system.
2. **Invent the Ticket dark mode.** Ticket has no blessed dark identity — the warm-dark values in
   `editorial-tokens.css`/`ticket-theme.css` are our invention; refine them, keep them warm (NOT cold gray,
   NOT Forge near-black). Every screen must be tested in both themes.
3. **NO FORGE.** Do not pull anything from `alive-labs-app-ui` (Forge) — it's placeholder chrome for
   unbranded apps. Anchor strictly to the **Ticket** palette (Rust `#B85C38`, Wire-Gold `#C9942A`,
   Clear/Teal `#3A8066`, Slate `#3D4F5F`, Alert `#C44040`, Ink, Paper, Thermal). The `--forge-*` token
   names in the CSS are harmless legacy aliases already pointing at Ticket values — leave them, don't lean on them.
4. **Brand repo = starting point, not gospel.** Branding gets formally rewritten after we land this. Extend
   the palette into a durable UI system as needed; make good holistic color choices.
5. **AA minimum.** 4.5:1 small text / 3:1 large+UI. Mid-tone brand colors (rust/gold) are fills/large-display
   ONLY; use `-deep` (`--rust-deep #8A3D20`, `--gold-deep #856017`) for small text. Flag any knowing
   violation inline + move on; don't block.
6. **Mobile is first-class and must do EVERYTHING.** Build mobile as a native-feeling app (glass top bar +
   fixed bottom tab bar, bottom sheets instead of right drawers, ≥44px targets, `env(safe-area-inset-*)`).
   No task may require desktop. Tablet (~768–1024) is a deliberate layout, not a stretched phone.
7. **Motion = "alive & smart."** Bake in meaningful micro-interactions everywhere they signal the system is
   working: entrance fade-up (staggered), card hover-lift, data bars/meters animating 0→value on in-view,
   stat count-up, live pulse dots, ambient canvas drift, accordion (grid-rows), drawer/sheet slide, toast.
   ALL must no-op under `prefers-reduced-motion: reduce`.
8. **Keep the left-nav layout** (Bryan #3) but restyle it to Concept A. Desktop = frosted left sidebar.
9. **Gradients** (from Concept C / the canvas): the fixed `.bg-atmos` multi-hue radial field is the prominent
   light-depth element; gradient FILLS (`linear-gradient(150deg, base, deep)`) on primary buttons, brand mark,
   weighted "weight" widgets, hero veils. Data-display surfaces stay `--card`. Tasteful, never cheap.
10. **Onboarding/auth/secondary** use the Dribbble pearlescent technique in Ticket hues (see §6).

## 2. Type system (LOCKED — do not change)
Already loaded via `next/font` in `app/layout.tsx` and wired in tokens:
- Display/headings/labels: **Space Grotesk** (`--font-display`/`--font-cond`), 600–700, tracking −0.02em;
  labels uppercase + tracked.
- Body/UI: **Inter** (`--font-sans`).
- Data/stats/overlines/"terminal" micro-labels: **Space Mono** (`--font-mono`), tabular-nums.
- Rare editorial flourish (the daily-brief LEAD headline only): **Fraunces** italic (`--font-editorial`).
Provisional pending the branding rewrite — but do not churn fonts in this build.

## 3. The kit — `components/ticket/` + `components/ticket/pass.css`
Port Concept A's `<style>` component rules (NOT its `:root` token block — tokens already exist) into a
scoped stylesheet, **prefix every class `tk-`** to avoid colliding with legacy `.pv-*`/Tailwind. Reuse the
existing tokens verbatim (Concept A already uses `--rust/--paper/--card/--shadow-*/--r-*/--t-*/--ease`).

Components (props are guidance; keep them small, composable; mark client islands `"use client"`):
- `TkButton` (variants: `act` rust-gradient / `keep` outline / `dismiss` ghost / `add` slate), min-height 44.
- `TkChip` (family-tinted), `TkConfidence` (ONE encoding product-wide: segmented pips — High=3 teal, Med=2 gold,
  Directional=1 + dashed/low-emphasis; one-tap expands to sources).
- `TkCard` / `TkPlayCard` (icon, title, summary, chips, viz slot, actions), `TkSoftPanel`.
- `TkHero` (2-col: photo/gradient-canvas left + body right; stacks photo-first on mobile; `--r-xl`, `--shadow-lg`).
- `TkWidgetGrid` + `TkWidget` (weighted: `repeat(4,1fr)`, `w-wide` span2, `w-tall` span2; gradient tiles for
  weight, `--card` tiles for data; 2-col ≤980, 1-col ≤460).
- Viz (client, animate-in on view): `TkRangeBar`, `TkSentimentRows`, `TkNumBig` (count-up — reuse
  `components/ui/animated-number.tsx`), `TkH2HBars`, `TkWindowViz`, `TkWeatherStrip`, `TkSocialEmbed`, `TkQuote`.
- `TkWhy` (the "Why we're confident" rolldown — `grid-template-rows:0fr→1fr` accordion, info-i + chevron).
- `TkDrawer` (right-slide desktop / **bottom-sheet mobile**, scrim, glass sticky header) for plan/draft/detail.
- `TkDismissReason` (popover capturing a reason → learning signal; + undo).
- `TkSectionHead` (h3 + sub + gradient hairline rule), `TkToast`, `TkTooltip`, `TkEmptyState`/`TkStillLearning`
  (the "still reading your block — N days in" state with `.sweep` animation).
- `RevealOnView` (IntersectionObserver client wrapper for entrance + data-reveal), respect reduced-motion.

## 4. Shell (keep left-nav; restyle to Concept A)
`app/(dashboard)/layout.tsx` + `operator.css` + `shell-nav.tsx` + `mobile-tabbar.tsx` + `account-menu.tsx`:
- Desktop: frosted glass left sidebar (brand mark = rust-gradient tile, location pill, nav with rust active
  tick, account flyout at foot) + **mount the theme toggle** (Pass-styled `.tk-theme-btn`, sun/moon) in the
  sidebar foot.
- Mobile: glass top app-bar (brand + location + account + theme toggle) + fixed bottom tab bar (the 5 nav
  items, rust active indicator, safe-area padding). Keep the existing `NAV_ITEMS` source.
- `.bg-atmos` canvas already mounts in the shell — keep it.

## 5. Per-surface map + data sources (rebuild ALL)
Dashboard (`app/(dashboard)/`): `home` (flagship — `brief-view.tsx`+`brief.css`, data from `lib/insights/daily-brief`),
`home/[rank]` (play detail drawer/page), `home/pool` (insight pool), `insights`, `ask`, `competitors`(+`[id]`),
`content`, `events`, `weather`, `traffic`, `visibility`, `social`, `photos`, `locations`(+`new`),
`settings`(+`billing`,`organization`,`team`). Each is a server component pulling real data — map it HONESTLY to
the kit (no fake POS/$/covers; %/estimated language; "you vs competitor" labeled).
Auth: `(auth)/login`,`(auth)/signup`. Onboarding: `onboarding`(+`trial`), `preview-onboarding`, `organizations/new`.
Landing: `app/page.tsx` (+`landing.css`). Admin (full rebuild): `app/admin/*`.

## 6. Onboarding / auth / secondary (Dribbble pearlescent)
Refs (fetch + save to scratchpad): the 3 Dribbble PNGs in the original brief. Translate the *technique* into
Ticket hues: pearlescent multi-hue canvas (rust→gold→teal→slate, desaturated, low-opacity radial glows over
`--paper`); floating soft-shadow panels (radius 24–28, `--shadow-lg`, generous negative space); big display
headings; dark-pill (`--ink`) or rust-gradient CTAs; split layout desktop / single column mobile. Apply the
same treatment to payment/upgrade dialogs, plan-picker, settings sheets, success moments.

## 7. UX gaps to close while rebuilding (`docs/ux-gaps-tracker.md`)
Manage watched entities (own + competitor social handles: add/change/remove + trigger discovery) homed on the
Competitors header + Ask box + empty-state CTAs on any social card; per-handle provenance badges
(verified/discovering/not-found); confidence "why" on every card; dismiss captures a reason (+undo);
first-run/"still learning" states on every trend/position view.

## 8. Apply-agent rules (for page-rebuild subagents)
- Edit ONLY your assigned page's files (its `page.tsx` / page-scoped components / page-scoped CSS).
- NEVER edit the shared tokens (`editorial-tokens.css`, `ticket-theme.css`, `globals.css`) or the kit
  (`components/ticket/*`). If you need a new token/utility/kit prop, NOTE it in your return; the main loop adds it.
- Import and compose the kit. Reuse real data wiring already in the page (keep server-component data fetching,
  server actions, types) — change the PRESENTATION, not the data layer or business logic.
- Both themes. Mobile complete. Motion. AA.
- Do NOT run git or the verify gate or push — the main loop owns gating/commits/merge.

## 9. Verify gate (main loop owns)
`npx tsc --noEmit` + `npm run test:unit` + `npx next build` green, then actually RENDER + screenshot each
screen (light/dark/mobile/tablet) and compare to Concept A before claiming done. Merge to `main` only when sure.
