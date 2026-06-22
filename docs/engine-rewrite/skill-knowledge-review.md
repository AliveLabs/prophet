# Skill Knowledge Review — food-pairing@v1 & guerrilla@v1 (offline, for Bryan + Chris)

**Why this exists:** P6 added two expert producer skills. Their domain "playbooks" (the prose the model
reasons from) were authored v1 by Claude, grounded in repo principles + general operator craft, and
**flagged for your domain review** — the same status marketing@v1 / operations@v1 carry. Knowledge must be
**CURATED from real operator knowledge, not invented.** This doc lets you complete that review async.

**How to use:** for each numbered claim, mark ✅ (accurate, keep) / ✏️ (change — write the fix) / ❌ (wrong/
remove). Add anything MISSING under "Gaps." When done, hand back (or edit the source directly) and I'll fold
edits into the knowledge files and bump to `@v2`.

- Sources: `lib/skills/food-pairing/knowledge.ts`, `lib/skills/guerrilla-marketing/knowledge.ts`
- These are region/season-agnostic on purpose — the dossier grounds the specifics. Review the PRINCIPLES.
- The model never invents numbers; "margin/prep-speed" stay qualitative (the dossier has no margin/cost data).

---

## A. food-pairing@v1 — the kitchen / menu merchandising expert
*Owns: WHAT to feature/special and WHEN (plate × weather × season × daypart). Not staffing (local-demand),
not posting cadence (marketing).*

Claims to verify:
1. **Match the plate to the weather** — cold/wet → feature warm, slow-cooked, comfort items already on the
   menu; heat → light, fresh, cold, crisp items. Only feature dishes that exist on their menu.  ☐
2. **Lean into the season** — feature in-season ingredients the menu already uses, or a low-effort seasonal
   swap (no new supplier / no menu redesign).  ☐
3. **Margin & speed are a qualitative tie-breaker** — among items that fit, prefer higher-margin + faster-to-
   fire during a rush (a shareable/high-margin signature over a labor-heavy plate). Stated in words, never a
   margin %, food cost, or ticket-time number.  ☐
4. **Merchandise the add-on** — pair the feature with a natural higher-margin add-on (drink/side/dessert);
   suggest a combo only if the POS can ring it.  ☐
5. **Close a menu gap the easy way** — on a signature-missing / category-gap signal, spotlight the signature
   or add ONE low-effort item that fits the kitchen; never a full menu overhaul.  ☐
6. **Fit check first** — respect cuisine, price tier, voice, and dayparts served; produce nothing if nothing
   genuinely fits.  ☐

**Gaps — what would a real chef/operator add that's missing?** (e.g., LTOs / limited-time-offer mechanics,
prep-ahead vs à-la-minute tradeoffs, cross-utilization of existing inventory to cut waste, anchoring a
feature to a protein you over-bought, dessert/beverage attach rates, "86 risk" on a pushed item…)
> _your notes:_

**Anything wrong or risky for a restaurant?**
> _your notes:_

**Sign-off:** reviewer ___________  date ______  verdict: keep-v1 / needs-v2

---

## B. guerrilla@v1 — the zero-budget, hyper-local growth expert
*Owns: offline neighborhood hustle (WOM, signage, partnerships, foot-traffic interception). Not digital/
social content cadence (marketing), not staffing/prep (local-demand). Category: Grassroots.*

Claims to verify:
1. **Every play ~free** — runnable for the cost of a marker, paper, and the owner's time; shines for none/low
   budget; never assumes a printer, agency, designer, or ad account.  ☐
2. **Foot-traffic interception** — when a nearby event / predictable foot-traffic window is within walking
   distance, put the restaurant in the path: A-frame at the right corner/time, sample tray by the door, hand-
   flyer for a same-day offer. Respect service model (drive-thru/takeout works the lane + pickup, not a board).  ☐
3. **Community partnerships** — trade value with nearby NON-competing businesses, schools, gyms, churches,
   offices, local teams: cross-promo, fundraiser night (a share of a slow night to a local school/team brings
   their families), hosting a local club's meetup in a dead window.  ☐
4. **Word-of-mouth seeding** — turn happy regulars + existing customer photos into referrals: a "bring a
   neighbor" card, a regulars' shout-out, a low-tech punch card; lean on UGC / crowd-perception signals.  ☐
5. **Fill a dead window** — on a slow-daypart signal, design a zero-cost reason to come (industry night,
   neighborhood happy hour, kids-eat-free if it fits), anchored to a daypart they actually serve.  ☐
6. **Work the sidewalk** — a clear, current, well-placed A-frame/window message; one offer, one line.  ☐
7. **Fit check first** — respect concept, service model, and the owner's time (ONE simple move, not a campaign).  ☐

**Gaps — what real grassroots tactics are missing?** (e.g., local press / neighborhood newsletters, Nextdoor
& community FB groups, loyalty/referral mechanics, charity tie-ins, local-business chambers, seeding to
nearby hotels/concierges, "regular of the week," collab with a neighboring complementary business…)
> _your notes:_

**Anything wrong, off-brand, or that could backfire?** (e.g., is "kids-eat-free" appropriate to suggest by
default? sampling/flyering rules vary by city…)
> _your notes:_

**Sign-off:** reviewer ___________  date ______  verdict: keep-v1 / needs-v2

---

## C. Cross-cutting questions
- Is the **boundary** between these two + the existing marketing / local-demand / operations skills right, or
  do any overlap in a confusing way? (P6 split guerrilla into its own "Grassroots" category for this reason.)
- Tone: is "Ticket's voice" (direct, plain, no jargon, for a busy owner at 6am) landing in the prose?
- Any tactic here you'd never want surfaced to a customer-facing operator?

**Next step after review:** edits → `knowledge.ts` files, bump `knowledgeVersion` to `@v2`, re-run the eval
suite, redeploy. (Knowledge is injected into the cached system prompt, so a bump is cheap to ship.)
