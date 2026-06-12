# Insights & Onboarding Review — Action Plan (2026-06-11)

Source: Notion meeting notes "Insights and Onboarding review" (Jun 11, 2026, Bryan +
Chris; Raising Cane's walkthrough). This doc isolates the actionable items, the open
questions, and the execution order. Status boxes update as batches land.

## Facts settled by reading the code (corrects the meeting's assumptions)

- **Image analysis = Gemini 2.5 Flash** (`lib/providers/gemini.ts`) over **Google
  Places photos** (`lib/providers/photos.ts` → places.googleapis.com media API).
  Not Claude, not classic Google Cloud Vision. The generic outputs ("vibrant color",
  "good natural light") are a prompt/model-quality problem → run the bake-off (B3).
- **Posting-frequency bug confirmed**: `lib/social/normalize.ts` divides post count
  by the span between the first and last post returned — no recency window. A dark
  account (last post 1,615 days ago) reads as "2x/week". Feeds
  `social.posting_frequency_{gap,low,strong}` in `lib/social/insights.ts`.
- **Stored snapshots carry precomputed aggregates** — windowing fixes apply to NEW
  pulls; numbers self-correct at the next daily refresh after deploy.
- Daily pull runs **6:00 UTC**, brief build 8:00 UTC (meeting said "4am GMT" —
  either way, Cane's data lands overnight).

## Batch A — Ops (urgent, Bryan or Bryan-authorized) 🔴
- ☐ **Cancel the live Stripe trial** started in the walkthrough — auto-charges
  ~$299 at day 14 (`cs_live` checkout; prod confirmed live mode). Stripe dashboard
  → Subscriptions → cancel, or authorize Claude + live key access.
- ☐ Resolve open question Q1 (live vs test mode) — see below.

## Batch B — Signal correctness: social windowing + honest language
- ☐ `normalize.ts`: windowed posting frequency — compute over the last
  **90 days** (recommendation; parameterized) instead of account lifetime; expose
  `postingWindowDays` + `postsInWindow` + `lastPostAt` in aggregates so copy can
  cite the window. Accounts younger than the window use account age.
- ☐ Engagement language: engagement rate is per-post-when-posting — phrase as
  "when you post, engagement averages X%"; never alongside "posts 2x/week" derived
  from stale history. Kill contradictory combos (0 posts/35 days + "63% engagement"
  presented as current health).
- ☐ Transparency rule: every numeric social data point carries its window in copy
  and in insight evidence ("over the last 90 days", "last 30 days", "account
  lifetime"). Evidence fields include windowDays (grounded via the eval ref index).
- ☐ Update the three posting-frequency insights + any skill-prompt guidance that
  consumes `postingFrequencyPerWeek`.
- ☐ Tests: the 1,615-day dark-account case (windowed freq 0, no false "2x/week"),
  the corrected-behavior case (dark 6 months, 3x/week last 8 weeks → positive
  signal), engagement-language phrasing, window metadata present.

## Batch C — Onboarding loading UX ("pizza tracker")
- ☐ Extend the existing per-pipeline checklist (ProcessingStep already shows live
  step rows — the pattern the meeting liked): add elapsed time + honest expected
  time per step; replace the "usually takes a minute or two" copy (insights can
  take far longer).
- ☐ "Close this tab" path: email (and/or browser push) when the first brief is
  ready — new first-brief-ready trigger on the existing Resend infra + new-brief
  toast plumbing.

## Batch D — Feedback + billing UX
- ☐ "Report as inaccurate" on insights — extend the play_actions feedback rails
  (save/snooze/dismiss) with an insight-level inaccuracy report; feeds the
  recalibration loop.
- ☐ settings/billing page redesign — visual pass on the ux-rework branch + Vercel
  preview comment loop (functional states were rebuilt 2026-06-11; this is the
  "ugly" part).

## Batch E — Test accounts & evaluation
- ☐ Set up **Airways (Arlington, near AT&T Stadium)** to evaluate event-proximity /
  venue-driven insights (use an internal org so no trial friction).
- ☐ Review Raising Cane's data + brief the morning after its first overnight
  refresh; specifically check the social windowing output once Batch B is live.

## Batch F — Research (no build yet)
- ☐ **Image model bake-off**: Gemini 2.5 Flash vs Claude (Sonnet) vision on the
  same real photo sets (Bush, Cane's): specificity, actionability, cost/photo.
  Generic-phrase rate as the metric ("vibrant color" count).
- ☐ **Mobile feasibility scoping doc**: native vs WebView wrapper vs PWA; owner
  workflows phone-first; push notifications tie-in (pairs with Batch C's notify-
  when-ready).
- ☐ Competitor-relevance scoring tweak (meeting: Taco Bell ≫ Wendy's for Cane's):
  weight price tier + traffic comparability in discovery scoring — or leave to
  manual curation. Decide after Airways data.

## Open questions (Bryan/Chris)
1. **Stripe mode — notes contradict**: action item "switch back to test mode" vs
   decision "stay live with careful trial management". If staying live, add
   internal-testing guardrails (100%-off promo code or internal-email allowlist).
2. Image bake-off criteria + who judges (Claude can run it; needs Q1 settled only
   for cost accounting).
3. Frequency window: 30/60/90 days? **Recommended: 90-day window + 30-day recency
   signal, both labeled in copy.** Proceeding with this unless overridden.
4. Mobile: appetite for a scoping doc now, or after current UX batches?
5. Competitor scoring: tweak now or post-Airways?

## Execution order
B (tonight, this session) → C → D → E in parallel as data lands → F as half-day
experiments. A is independent and urgent — Bryan.
