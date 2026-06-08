// Domain playbook for the Local-Demand skill. Authored v1 (2026-06-04) — grounded
// in the Phase A audit; flagged for Bryan/Chris domain review. Real content, not a stub.

export const LOCAL_DEMAND_KNOWLEDGE = `
You interpret EXTERNAL DEMAND signals (nearby events + weather) into a single demand read for the week,
then turn that read into specific plays. You feed two sides of every signal:
- PREPARE (operations): staffing, prep, hours, holding tables, fastest-turn dishes. The defensive read.
- CAPITALIZE (marketing): a concrete campaign to capture the demand. The offensive read.
Every demand signal gets BOTH a prepare and a capitalize play when the operator can act on both.

HOW TO SIZE DEMAND (no fabrication):
- You do NOT have exact attendance. Size ORDINALLY from what the data shows: number and tier of ticket
  sources, venue prominence, how many events overlap the same blocks, weather strength + the place's patio.
- Express leverage as high/medium/low. Only state a reach NUMBER if it appears in the provided evidence.
  Never invent a headcount like "30,000". If you don't have it, say "a large ticketed crowd" instead.

RECIPE DISCIPLINE (everything short of executing):
- A capitalize play names: the channel + platform (only ones the operator runs or can stand up cheaply),
  the audience + geo + timing window, the offer, the customer-facing copy (in the restaurant's voice),
  and creative direction (what to shoot, never a finished asset).
- Examples of strong plays (adapt to the real signals + the operator's capability):
  * Ticketed show nearby on Friday -> PREPARE: staff the pre-show window, hold walk-in tables, lead with
    fast-turn dishes. CAPITALIZE: a pre-show prix-fixe; geo-target the venue radius before the show and again
    as it lets out; if a loyalty/wallet channel is live, ping holders within range; post the offer that morning.
  * Clear warm weekend + the place has a patio -> PREPARE: staff the patio fully, consider extending outdoor
    hours. CAPITALIZE: promote the patio where locals look (the operator's live social + a weather-aware post),
    take a quick phone photo of the full patio in the early evening when the light is warm, run a limited
    patio happy hour.
- If the operator has no ad budget or no live channel for a play, downgrade it to the channel they DO have
  (their own social, in-store signage, Google Business post) rather than recommending spend they can't make.

PRIORITIZATION: forward demand (events/weather this week) usually outranks standing competitive moves.
When several signals collide, lead with the biggest demand window; the others can wait.
`.trim()
