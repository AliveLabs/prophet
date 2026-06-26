# Ticket UX / functionality gaps — running tracker (started 2026-06-26)

Gaps in the CURRENT experience to resolve as part of the redesign (Bryan: "keep track of these as we work").
Not design concepts — missing functionality / flows. Add as we find them.

## Known gaps
- [ ] **Social handle management** — no place anywhere in the experience to ADD / CHANGE / REMOVE the
  operator's own or competitors' social handles, or trigger discovery. (Onboarding implies it exists; it
  doesn't have a real home.) [[ticket-social-handle-management-gap]]
- [ ] **Competitor management depth** — add/remove/approve competitors exists in admin-ish form; confirm the
  operator-facing flow is complete (approve discovered, add manual, remove).
- [ ] (more to be added as concepting surfaces them)

## Flagged during design concepting (2026-06-26 — the un-caged design panel surfaced these)
- [ ] **Manage watched entities (THE big one)** — nowhere to add/change/remove **competitors OR social
  handles**, despite every photo-card / head-to-head bar depending on the roster. Fix: a "The Set" / "Roster"
  surface from the Competitors header + the Ask box, plus empty-state CTAs on any social card ("not tracking
  @competitor's Reels — add them") so management lives where the absence is felt.
- [ ] **Per-handle provenance/verification** — handles need a verified / discovering / not-found badge; a wrong
  handle silently feeds bad data into insights with no way to spot or fix it.
- [ ] **Confidence "why" on every card** — High/Med/Directional must expand one-tap to the sources/signals
  behind it, or operators won't trust Directional plays. Directional needs an explicit low-emphasis visual.
- [ ] **Dismiss must capture a REASON** (not relevant / already doing it / wrong) + undo / "why shown" —
  a silent hide gives the ranking/learning loop no signal and isn't legible to the operator.
- [ ] **First-run / empty / low-data states** — a new operator has no 14-day position line or competitor
  history; every trend chart + the position hero need a "still reading your block — N days in" state.
- [ ] **One confidence encoding product-wide** — pick a single system (segment-tick / perforation-density is
  most legible) and apply it everywhere; don't mix dots vs meters vs density.
- [ ] Design note (not a gap): dark-first is correct for a 5pm glance-and-go tool; reserve light only for dense
  reading tables, never a whole-app theme; geographic maps don't work at 375px (keep territory as chart/calendar heat).

## Surfaced in Round-2 review (transcript + build)
- [ ] **Lead-category diversification / same-event clustering** — a single big event (e.g. AT&T Stadium) can
  drive multiple cards (hero timeline + channel-mix), making a quiet day feel thin/repetitive. Need a rule to
  diversify lead categories or collapse same-event plays into one expandable cluster.
- [ ] **Competitor swap-gating + cost control** — N swaps/month = competitor-slot count (e.g. 5 slots = 5
  swaps/mo, any combination; whole set once/month). Each change triggers a fresh data pull = COST → model it
  and enforce a no-re-add window so it can't be gamified for extra data slots.
- [ ] **Per-competitor social-handle visibility** — show which networks (IG/TikTok/Google Business) we watch
  per competitor (small per-network icons), and let the operator correct/add/remove them inline.
- [ ] **Confidence "why" depth + Directional honesty** — every confidence pip expands to its sources; Directional
  must look clearly lower-emphasis, never like High.
- [ ] **First-run / "still learning" states** — gate the competitive-position-over-time chart for the first 30
  days; show a "still learning your area — N days in" state instead of an empty/broken chart.
- [ ] **Estimated-reach / data-honesty labeling** — label whose number it is (you vs competitor); never imply
  POS/sales — use %/estimated language consistently.
