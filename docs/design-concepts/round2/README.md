# Ticket design concepts — ROUND 2 (2026-06-26 PM)

Built from the Bryan + Chris transcript review of the 4 un-caged concepts (Notion: "UI Design Concept Review").
Self-contained, responsive, INTERACTIVE HTML (open directly; resize to phone width for mobile). For review —
not shipped. Real competitor images (from our Supabase storage) are embedded as data URIs where it counts.

## The concepts
| File | What it is |
|---|---|
| `A-the-pass-refined.html` | **The Pass, refined** — light, hero-led, modular 2-col square cards. The safest-to-ship composite. |
| `B-widget-board.html` | **Widget Board** — iPad-home-screen weighted/variable-width widgets; combined events+weather+demand; inline handle/competitor management; competitive set with real photos. |
| `C-visual-forward.html` | **Visual-Forward (ambitious)** — full-bleed event hero, glass + gradients, real embedded competitor social, the "wow" swing. |
| `D-the-locale.html` | **The Locale — the WILD swing (v2, 2026-06-27)** — fundamentally different from the A–C card-feed. **v1** made the brief a trade-area MAP canvas; Bryan: that hero doesn't scale (no AT&T Stadium in a small town; the "block" falls apart at 1.6mi). **v2** reframes: the **LOCATION itself is the canvas** — the storefront photo under a painterly multi-hue Ticket-palette gradient (rust→cobalt→teal→gold) — scales to any location. Insights are **soft contained panels** (a quiet boundary + semantic edge, not a lifted card — middle path after Bryan flagged the cardless ledger read like a timeline). Spatial edge kept as a **"who's open when" closing-time strip** (TIME scales where geography doesn't). Light, cobalt **signal** accent + mono labels. Includes a dedicated **mobile phone-frame** (home + rivals), like A–C. Artifact: https://claude.ai/code/artifact/d8e83a64-95c6-4023-a24a-6b4357327c81 |

## How the transcript feedback was addressed
- **Light mode primary + working dark toggle.** Palette built out beyond rust+teal with gradients/textures.
- **Card actions = ACT + KEEP + DISMISS**, distinct real buttons (the broken/bleeding dismiss bug is gone).
  ACT drills into a plan/draft (honest CTA, not a silent dismiss). DISMISS captures a reason (feeds learning).
- **"Why we're confident" rolldown** with an obvious control; **embedded competitor social** as a real
  Instagram-style card (caption + engagement), with REAL competitor photos.
- **Interactions** (your report's pattern): hover/tap tooltips on charts, animated draw-in, drill-down panels.
- **Mobile first-class**: in-file ~390px phone frames (home → drilled detail → More), full bottom nav, no edge-swipe.
- **Honest data**: no "covers/rail/bump", no POS/$/ticket-count claims; %/estimated language. "Live reading" removed.
- **Weather**: all-weather, next-7 forecast + last-7/14 traffic-correlation evidence. **Position chart gated** to 30 days in.
- **Competitor mgmt** inline with per-network icons + the swap-rule note (N swaps/mo = slot count).

## Known minor gaps (quick fixes when we reel in the winner — not worth polishing all 3)
- **A:** last-7 weather shown as a correlation chart, not per-day tiles; theme-toggle aria-label not state-aware.
- **B:** secondary (non-hero) Dismiss buttons are icon-only (no visible frame/label) — make consistent with hero.
- **C:** ✅ FIXED 2026-06-27 — hero + both events-section cards now have ACT+KEEP+DISMISS(+reason) (reason
  feeds learning, consistent with the play cards); hero scrim strengthened so white hero text clears AA
  across the whole hero over any photo (+ dark photo-base fallback). Phone-mock dismiss still static (minor).

UX/functionality gaps surfaced are in `docs/ux-gaps-tracker.md`. Next: pick a direction (or fusion) → reel in + apply to the real app.
