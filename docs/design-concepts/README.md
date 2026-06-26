# Ticket insights — design concepts (mild → wild) · 2026-06-26

Three explorations of how to make Ticket's insights surface look like a **comprehensive, magical tool**
instead of a document dressed in badges. Produced by a design panel (8 divergent directions → 3 adversarial
critics → director synthesis → realized as standalone HTML mockups). Each is a self-contained `.html` file —
open directly in a browser. These are CONCEPTS to review together — nothing is shipped to prod.

## The shared diagnosis (what's wrong today)
Per the UI audit: no hierarchy (the insight card header has 5 equal-weight badges), no type range (everything
10–14px), color overload (every category/status/urgency is colored → color is wallpaper, not signal), and
**no anchor** — nothing the eye lands on first. `/insights` is a vertical content dump that opens with a filter bar.

## The shared POV (what all 3 fix)
- **One unmissable ANCHOR per insight** — a big number the eye lands on before reading anything.
- **Aggressive type scale** — a 52px hero + 28px action headlines + 15px body, not a flat 10–14px wall.
- **Rust (#B85C38) used in exactly 2–3 structural places** — scarcity makes it mean "this is the one." No category colors, no status pills.
- **Category becomes a quiet label, not a colored badge. Recipe renders inline, never a nested card-in-card.**
- The page opens with an editorial **masthead/hero**, not a filter bar; filters demote to a quiet row.

## The three concepts

| File | Tier | Name | The anchor | The idea |
|---|---|---|---|---|
| `01-mild-the-front-page.html` | MILD | **The Front Page** | An oversized **priority numeral** (0–100) per row, with the $ figure as a small mono overlay below | Evolves today's editorial DNA: a masthead lede, then a ranked column of dispatches. Safest, most shippable. |
| `02-medium-the-score-spine.html` | MEDIUM | **The Score Spine** | A **score gutter** (bond-filled rail) running every row, all 7 scores mono-aligned into one vertical spine you scan in a single sweep | A signal terminal built from paper + serif — "trusted overnight analyst," not a Bloomberg clone. |
| `03-wild-the-overnight-edition.html` | WILD | **The Overnight Edition** | A **masthead signal-count** ("read 1,247 signals → 7 moves") that proves the labor, + a big serif lead-story | "You don't open a tool, you receive an EDITION the AI printed overnight." Most magical; one restrained count-up on load. |

## How to use this
1. Open all three in a browser (they use the real Ticket brand tokens + real insight content).
2. Pick a direction (or a fusion) — we'll then apply it to the real components
   (`components/insight-card.tsx`, `priority-briefing.tsx`, the `/insights` + `/home` layouts, and the
   `editorial-tokens.css` / `ticket-theme.css` tokens).
3. Nothing here is wired to data or shipped — it's a look-and-feel decision aid.

Full per-direction specs + the critics' scoring are in the session log / workflow output.
