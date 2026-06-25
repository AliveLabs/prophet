# §4.6 Grassroots "Redemption" — REFRAMED by the 2026-06-24 Bryan + Chris review

> Source of truth: the Notion meeting **"Grassroots Marketing Skill: Archetypes, Card Actions &
> Learning Loop Review"** (2026-06-24) — read the TRANSCRIPT, not Notion's auto-summary.
> Status banner: **attribution/redemption write-back is CANCELLED for V1.** §4.6 = card-action
> redesign (Keep/Remove) + grassroots walkthrough copy + archetype cleanup. Bryan resolved all 6
> decisions on 2026-06-24; everything below is BUILT, verified (tsc clean, 661 tests pass), and
> COMMITTED + PUSHED to main (prod). **Exception: decision #5** (cosmetic stored-value rename
> `saved`/`dismissed`→`kept`/`removed`) is intentionally **DEFERRED** as a separately-sequenced
> migration — it is NOT safe to bundle into a blind prod push (see "Decisions" below).

## The reversal (why the original plan died)

§4.6 was scoped as a grassroots **redemption/attribution write-back loop**: a new outcome table, a
capture surface, a `redeemed` band signal, a "did it work?" follow-up, and a confirmed-win →
per-location archetype-weight promotion. **The meeting killed all of it for V1.** Bryan's standing
position (from day one with Claude): *"do not even flirt with trying to do attribution."* Reasons:

- Capture is **different for every business** (receipt tally / net-sales window / coupon code /
  third-party org) — can't be standardized in-system.
- Attribution is **too subjective**; owners often *don't know what worked or why* (confirmed in the
  Reddit scraping). Asking risks **reminding them of losses → churn.**
- Positioning: we are an **insights + recommendations (idea) engine, not a marketing agency**. We
  surface the idea + honest economics; we do **not** claim causation or measure outcomes.

**The learning loop relies on thumbs + Keep only. Nothing else.**

## What actually shipped (working tree, verified: tsc clean, 661 unit tests pass)

### 1. Card-action redesign — Save/Snooze/Dismiss → **Keep / Remove** (cross-cutting: every play card)
- **Keep** (stored as `saved`) — "do it later, don't let it disappear on refresh." Stays in the
  active stack, persists via evergreen resurfacing. A **positive, secondary** learning signal
  (below thumbs).
- **Remove** (stored as `dismissed`) — **visibility only.** Collapses into the "Cleared" strip,
  keeps the ~14-day cross-day cooldown so it won't regenerate, but contributes **ZERO** to learning
  (ambiguous: may mean "already did it" / "can't now" / "don't like it"). Neutral hover (no longer
  the red "destructive" styling).
- **Snooze** — **retired** (Keep covers "do it later"). UI no longer emits it; legacy rows still
  render + are undoable.
- **Thumbs ↑/↓** — unchanged; the **primary** quality signal.

Files: `lib/skills/feedback-signals.ts` (the band — one-file retune, the "action-semantics review"
the file was waiting for), `app/(dashboard)/home/play-action-buttons.tsx`, `brief-actions.ts`,
`brief-view.tsx`, `brief.css`, `tests/unit/skills/feedback-rollup.test.ts`.

The band retune (the single tuning point):
| action (stored) | UI label | polarity | weight | confidence | effect |
|---|---|---|---|---|---|
| `thumbs_up/down` | 👍/👎 | ±1 | 1.0 | 0.95 | PRIMARY |
| `saved` | **Keep** | +1 | 0.5 | 0.5 | positive, secondary |
| `dismissed` | **Remove** | 0 | 0 | 0 | **no signal** (visibility only) |
| `snoozed` | (retired) | 0 | 0 | 0 | neutralized |

> **No DB migration was done.** Stored values stay `saved`/`dismissed`; `play_actions.action` CHECK
> still allows `snoozed`. An OPTIONAL cosmetic migration could later rename stored values to
> `kept`/`removed` — purely for readability; behavior is already correct. Migrations can't run from
> the agent shell, so this is Bryan's to run if he wants it.

### 2. Grassroots walkthrough copy (`lib/skills/guerrilla-marketing/knowledge.ts`)
- Spirit-night **attribution** rewritten as the agreed **menu of capture options** the operator
  picks from: (a) receipt tally, (b) net-sales window (e.g. 5–10pm, flat %), (c) coupon/"mention
  [GROUP]" code, (d) route through their existing fundraising/tracking org. **No vendor named.**
- Event-activation note updated: code/QR is **operator-run**; the system does NOT capture/write back
  redemptions (V1).
- New global principle **"ATTRIBUTION IS THE OPERATOR'S, NOT OURS (V1)"**: present options, never
  prescribe, never name a vendor, never claim we measure/confirm results.

## Archetype review findings (meeting action items)

**Definitions resolved (read from `knowledge.ts`):**
- `catering_lunch_driver` = a **mechanism that drives recurring catered group-lunch orders** from a
  NAMED nearby workplace (office/clinic/dealership), gated on a weekday-lunch softness signal — i.e.
  become their default lunch via a sampler drop → standing weekly order. (Bryan's 2nd reading was
  right; it is **not** "a driver who delivers catering.") **The name is confusing → consider rename**
  (e.g. *Workplace Lunch Engine* / *Standing Lunch Order*).
- `earned_media_stunt` = a **shareable, on-brand, low-cost stunt** that earns local press / word of
  mouth (e.g. the viral-social moment Bushes attempts). Lowest-priority archetype, gated on the
  operator actually having social capacity. (Bryan's guess was right.)

**⚠️ Source-citation finding:** the archetypes + their economics are **authored industry priors baked
into the skill prompt — there are NO per-archetype external source citations.** The file header even
says so ("Authored against real grassroots / fundraiser-economics practice, NOT the model's generic
priors"). If Bryan wants real citations per archetype, that's a P9-curated-sources task, not a quick
lookup. Aligns with [[bryan-experts-first-requirements]].

## WIRED new archetypes (APPROVED by Bryan 2026-06-24 — now live in the skill)

Added to `GRASSROOTS_ARCHETYPES` + `ARCHETYPE_PARTNER_TYPES` + `selectInput` + `knowledge.ts`. Both
are framed to **never state a fabricated dollar figure** (Sponsorship = qualitative exposure;
General Outreach = a range, never a count) — consistent with the skill's anti-fabrication contract
and [[bryan-experts-first-requirements]]. They fire only on the model path with a named anchor; empty
catalog → no fire (fail-soft unchanged).

### A. SPONSORSHIP
- **Anchor:** a NAMED local team / league / event / nonprofit (semi-pro or amateur sports team, school
  booster, charity event).
- **Mechanics:** provide food (post-game team meals, VIP/hospitality catering at an event) OR a
  straight donation/sponsorship check, in exchange for brand presence (banner, jersey, PA mention,
  social) + goodwill + a warm audience.
- **Distinct from:** `spirit_night` (there you host a donation night and borrow their promo; here you
  give) and `catering_lunch_driver` (there it's a recurring B2B order; here it may be a check).
- **Economics:** size from the restaurant's COST (food cost of donated meals OR check size) against
  audience/goodwill reached — framed as **brand exposure + relationship, NOT a tracked sales return**
  (no attribution). Range only, assumptions shown.
- **Caution (Bryan's point):** amateur "teams" are often a **pay-for-participation business**, not a
  501c3 — flag the tax/relationship difference; don't conflate a donation with a for-profit sponsorship.

### B. GENERAL OUTREACH
- **Anchor:** a NAMED nearby employer / office / club / group (or a cluster).
- **Mechanics:** seed trial by **dropping off free lunch cards, drink/appetizer cards, or sample
  trays** to employers/clubs/groups — lower-commitment and broader than the catering standing-order
  pitch to a single decision-maker.
- **Distinct from:** `catering_lunch_driver` (recurring standing order to a decision-maker) and
  `reciprocal_partner` (a mutual cross-promo).
- **Economics:** redemption-rate prior × card value × headcount band; trial → repeat is the win.
- **Attribution:** operator-owned; cards can carry a code (operator-tracked).

> **Boundary design needed:** General Outreach vs `catering_lunch_driver` vs Sponsorship must have
> clean fire conditions so the skill doesn't double-emit overlapping plays.

## Decisions (resolved by Bryan 2026-06-24)
1. **Keep's weight** — KEEP as shipped `{+1, 0.5, 0.5}` (positive, below thumbs). No change.
2. **Remove's cooldown** — CONFIRMED: keep the ~14-day cross-day cooldown + zero learning weight.
3. **Rename `catering_lunch_driver`** — DONE → `workplace_lunch` (internal id only; verified it is NOT
   in any learning key or persisted play — `playTypeLeadDomain` is hardcoded `"grassroots"` — so no
   orphaned rollup data). Human label: "Workplace Lunch (recurring/standing catered group-lunch)."
4. **Add Sponsorship + General Outreach** — APPROVED + wired (see above).
5. **Cosmetic stored-value rename** (`saved`/`dismissed`→`kept`/`removed`) — Bryan said yes, but
   **DEFERRED as a sequenced follow-up, NOT in the prod push.** WHY: `play_actions.action` has a CHECK
   constraint `in ('saved','snoozed','dismissed')`. A value rename is an expand→migrate→contract dance
   (1: widen the CHECK to allow the new values; 2: flip code to write new + read both; 3: backfill old
   rows; 4: contract the CHECK). Prod migrations can't run from the agent shell, and if code that writes
   `kept`/`removed` deploys BEFORE the widening migration applies, **every card action fails the CHECK in
   prod.** Behavior is already 100% correct with the legacy values (the band keys on them; the UI shows
   Keep/Remove). So it's pure cosmetics with real deploy-ordering risk → do it deliberately later, not
   bundled into a "push now". Code already documents the Keep=saved / Remove=dismissed mapping.
6. **"Did it work?" follow-up nudge** — AGREED: parked, not this phase. Revisit only if attribution is
   ever reconsidered.
