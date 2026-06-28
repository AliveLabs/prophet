# ▶ DESIGN SESSION — START HERE (Ticket UI direction)

> This file is the brief for a **dedicated design session**. The code-health audit work is done
> (see `docs/SESSION-HANDOFF.md`); this session is **only about the Ticket app's visual/UX direction**.

---

## 0. OPERATING MODE (Bryan, 2026-06-28 — read first)

- **Ultra Code is ON for this session by Bryan's choice.** Optimize for the **best possible design + code**, not the fastest/cheapest path.
- **BUT Bryan is on paid usage credits** — efficiency and money matter. The rule is **hybrid, deliberate**:
  - **Push hard + think deep where it actually changes the output** — the design direction, the visual system, the hard layout/interaction calls, the real component build. Don't half-ass anything that matters.
  - **Farm out to sub-agents on cheaper/faster models where deep thinking won't gain anything** — boilerplate, asset wrangling, mechanical refactors, parallel "read these files and report" scouting, repetitive component scaffolding. Use the Workflow tool's hybrid patterns: cheap models (`opts.model`/`opts.effort: 'low'`) for the grunt stages, top model for the judgment/synthesis stages.
  - **The hybrid when the hybrid serves — never half-assed.** If deep thinking buys quality, spend it. If it doesn't, don't burn premium tokens on it.
- Net: **no slop, no over-spend.** Best design we can generate, efficiently produced.

---

## 1. THE DECISION WAITING ON BRYAN

**Pick a design direction (or a fusion), then reel it in and apply it to the real app.** Four round-2
concepts exist; Bryan has reviewed but **not yet chosen**. Nothing should be restyled in the real app
until the direction is picked (per the root-cause lesson in §3).

### The four round-2 concepts (`docs/design-concepts/round2/`, self-contained HTML — open + resize to phone width)
| Concept | File | What it is | Artifact |
|---|---|---|---|
| **A — The Pass (refined)** | `A-the-pass-refined.html` | Light, hero-led, modular 2-col square cards. **The safest-to-ship composite.** | `debeba1e` |
| **B — Widget Board** | `B-widget-board.html` | iPad-home-screen weighted/variable-width widgets; combined events+weather+demand; inline handle/competitor mgmt; competitive set with real photos. | `2594e887` |
| **C — Visual-Forward** | `C-visual-forward.html` | Full-bleed event hero, glass + gradients, embedded competitor social. **The "wow" swing.** | `b8ec6e0d` |
| **D — The Locale (the WILD swing, v2)** | `D-the-locale.html` | Fundamentally different from the A–C card-feed: the **LOCATION itself is the canvas** — storefront photo under a painterly multi-hue Ticket-palette gradient (scales to any location); insights as **soft contained panels** (boundary, not lifted cards); a **"who's open when" closing-time strip** as the spatial edge. Light, cobalt "signal" accent, mono labels. Includes a mobile phone-frame. | `d8e83a64-95c6-4023-a24a-6b4357327c81` |

(Earlier rounds for reference: `docs/design-concepts/01..03-*.html` (mild→wild) and `docs/design-concepts/uncaged/*`.)

### What "pick a direction" actually unlocks
Once Bryan picks (likely a **fusion** — e.g. A's ship-ability + D's canvas hero + B's inline entity
management), the work is: **reel the winner in → build it as real components in the app → close the UX
gaps** (`docs/ux-gaps-tracker.md`, especially the social-handle / competitor management gap, which every
photo-card and head-to-head bar depends on).

---

## 2. THE GOAL: PREMIUM **LIGHT**, NOT FLAT

The target is software that looks like a premium product — **light + dimensional**, not dark, and NOT
the flat "newspaper" look. All four concepts are intentionally light. The fix for "doesn't look premium"
is **depth** (gradient/canvas, soft elevation, real negative space, motion), not going dark.

---

## 3. MUST-READ CONTEXT (why we're here — don't repeat the mistake)

- **`docs/design-gap-diagnosis-2026-06-26.md`** — the root cause: the app shipped a flat light **newsprint/editorial** skin as whole-app chrome (conflated "restraint over hype" with visual flatness; literalized "a briefing" as a newspaper — also an AI-design cliché). The premium **dark/dimensional "Forge" app-UI system already exists** in the **AliveLabs/Brand** repo (plus a Ticket `.dark` mode + glow shadows), currently **UNUSED**. This is NOT a capability problem — it's a direction-not-yet-chosen problem.
- Memory notes (auto-loaded): `[[ticket-design-gap-rootcause]]`, `[[ticket-design-concepts]]` (the A/B/C/D round), `[[ticket-design-gap]]`. Read before touching any design.
- **Do NOT restyle the real app until Bryan picks a direction.** (Standing rule.)

### Standing design constraints (Bryan)
1. Stay **light**.
2. Extend (not limited to) the **Ticket palette** (rust / teal / cobalt / gold) — palette + gradients + texture, not just two colors.
3. **Background as a prominent canvas element** (D leans hardest into this).
4. **Maximize negative space.**
5. **Cards OK for containment** — don't over-chrome; soft panels are a fine middle path.
6. Concepts must **SCALE across location types** (no "stadium next door" assumption — works for a small-town spot too).
7. **Always include mobile** (every concept ships a phone frame).

---

## 4. WHEN A DIRECTION IS PICKED — APPLYING IT
- The real app is Next.js 16 / React 19 / Tailwind 4 (the `prophet` repo, cloned as `GetTicket`).
- Reuse/raid the existing **Forge** system in AliveLabs/Brand (dark/dimensional primitives, glow shadows, the Ticket `.dark` mode) — adapt to the chosen light direction rather than rebuilding from scratch.
- Verify gate before any push (same as eng): `npx tsc --noEmit` + `npm run test:unit` + `npx next build`. Deploy = push to `main` → Vercel auto-deploys.
- Close UX gaps as you build: `docs/ux-gaps-tracker.md` (social-handle/competitor management is the big one).

---

## 5. PARKED (non-design) TODO — don't lose it
- **ENG-M6 live verification:** the insights/traffic pipeline-concurrency changes shipped 2026-06-28 (`8ef8b3d`) are **LIVE-ONLY (no CI coverage)**. After the next daily cron (and next Monday for `traffic`/busy_times), **read `pipeline_runs` / `/api/health/pipeline` to confirm those jobs complete clean** (no new failures) under the new bounded concurrency. Tracked as a spawnable task chip + in `docs/SESSION-HANDOFF.md`.
- Also still optional from the audit: ENG-M6 `visibility.ts` DataForSEO loops (DEFERRED — throttle risk) + cosmetic redundant `as unknown as <Store>` casts in cron/actions/preview.
