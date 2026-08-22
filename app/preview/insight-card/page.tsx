// DEV/REVIEW-ONLY — the unified insight card proposal (no auth, no DB, prod-guarded by
// the /preview layout). Renders the REAL <UnifiedInsightCard/> against representative
// data for all three tiers, then shows the two contexts it has to work in: the home
// brief and the all-insights view.
//
// Sections 1-4 are hand-written fixtures with nothing wired: Keep/Dismiss and the plan
// disclosure hold local state, so the card can be judged as an interaction rather than a
// screenshot.
//
// Section 5 is different and is the one to trust. It renders the REAL <BriefInsightCard/>
// that /home now mounts, driving a fixture `EnrichedRecommendation` through the REAL
// adapter. So it exercises the wired path end to end: the play → UnifiedInsight
// translation, the derived tier, the evidence slots, and the win-flag. Only the server
// writes are inert here, because there is no session.

import ThemeToggle from "@/components/ui/theme-toggle"
import { PassHeroCanvas } from "@/app/(dashboard)/home/pass-hero-canvas"
import { BriefInsightCard } from "@/app/(dashboard)/home/brief-insight-card"
import { TkToastProvider, TkTooltipLayer } from "@/components/ticket"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import UnifiedInsightCard, {
  type UnifiedInsight,
} from "@/components/insights/unified-insight-card"
import "./preview-insight-card.css"

/* ── A fixture play, shaped exactly like what the skills engine persists. Section 5 runs
      this through the real adapter, so anything the adapter drops or mis-derives shows up
      on the page instead of in production. The title carries `[[markup]]` so the accent
      renderer is exercised too. ── */
const FIXTURE_PLAY: EnrichedRecommendation = {
  title: "Open a pre-show window [[Saturday]] before the arena crowd walks past you",
  rationale:
    "There is a 7:30pm show 0.6 miles away and your Saturday covers drop off after 6pm. The crowd walks your block on the way in, and nothing on your listing tells them you are open and quick.",
  skillId: "local-demand",
  ownerRole: "marketing",
  kind: "capitalize",
  confidence: "high",
  stance: "capture",
  category: "demand",
  knowledgeVersion: "v1",
  severity: 1,
  evidenceRefs: ["events.nearby:arena-show", "review.theme:wait-times"],
  leverage: { label: "high", basisInternal: "internal only" },
  evidence: [
    {
      source: "review.theme:wait-times",
      quote: "Waited almost forty minutes for a table on a Friday with half the dining room empty.",
      rate: { numerator: 3, denominator: 20, pct: 15 },
      asOf: "2026-07-26",
    },
  ],
  presentation: {
    advantage: true,
    sentimentByCategory: [
      { category: "wait", pct: 38, direction: "negative" },
      { category: "price", pct: 21, direction: "negative" },
      { category: "food", pct: 9, direction: "negative" },
    ],
    confidenceBasis: [
      { source: "Events", whatWeSaw: "One ticketed event inside a mile, doors before your dinner peak." },
      { source: "Foot traffic", whatWeSaw: "Your Saturday traffic falls off after six on your last six Saturdays." },
    ],
  },
  recipe: [
    {
      channel: "PAID_SOCIAL",
      platforms: ["INSTAGRAM", "META_ADS"],
      audience: "Adults within 1 mile of the arena, 4pm to 7pm Saturday",
      window: { start: "2026-08-01", end: "2026-08-01", note: "Set live Friday, runs Saturday 4pm to 7pm" },
      offer: "Two courses in 45 minutes, $32",
      creativeDirection: "A tight crop of the sear, warm side light, no people in frame",
      copy: "Doors at 7:30? You have time. Two courses, 45 minutes, three blocks from the show.",
      dependencies: ["the kitchen can hold a 45-minute ticket", "the $32 pairing is ringable on the POS"],
    },
    {
      channel: "GOOGLE_BUSINESS_PROFILE",
      platforms: ["GOOGLE_BUSINESS"],
      audience: "Anyone searching nearby that afternoon",
      window: { start: "2026-07-31", note: "Update Friday so it is live before the search spike" },
      copy: "Pre-show seating until 7pm Saturday. Walk-ins welcome.",
    },
  ],
}

/* ── Tier 1: a real plan. What the skills engine already produces today. ── */
const PLAN_LEAD: UnifiedInsight = {
  id: "p1",
  title: "Open a pre-show window Saturday before the arena crowd walks past you",
  why: "There is a 7:30pm show 0.6 miles away and your Saturday covers drop off after 6pm. The crowd walks your block on the way in, and right now nothing on your listing or your feed tells them you are open and quick.",
  validation: "Based on one event within a mile on Saturday and your last 6 Saturdays of foot traffic.",
  tags: [
    { axis: "what", label: "Local events" },
    { axis: "when", label: "Next day or two", urgent: true },
    { axis: "state", label: "On this week's brief" },
  ],
  confidence: "high",
  impact: "high",
  detailHref: "#",
  whyPoints: [
    "One ticketed event inside a mile, doors before your dinner peak.",
    "Your Saturday traffic falls off after six on your last six Saturdays.",
    "Nothing on your listing or your feed mentions a pre-show option.",
  ],
  evidence: [
    { label: "Event listing, Saturday", text: "Doors 7:30pm, arena, 0.6 miles from your address." },
  ],
  plan: [
    {
      channel: "Paid social, tight radius",
      platforms: ["Instagram", "Meta Ads"],
      audience: "Adults within 1 mile of the arena, 4pm to 7pm Saturday",
      window: "Set live Friday, runs Saturday 4pm to 7pm",
      offer: "Two courses in 45 minutes, $32",
      copy: "Doors at 7:30? You have time. Two courses, 45 minutes, three blocks from the show.",
    },
    {
      channel: "Your Google Business Profile",
      audience: "Anyone searching nearby that afternoon",
      window: "Update Friday so it is live before the search spike",
      copy: "Pre-show seating until 7pm Saturday. Walk-ins welcome.",
    },
    {
      channel: "In-store",
      audience: "Walk-past traffic on the arena side",
      window: "Saturday from 4pm",
      offer: "A-frame at the corner with the 45-minute promise",
    },
  ],
}

const PLAN_2: UnifiedInsight = {
  id: "p2",
  title: "Answer the three wait-time reviews before they set your average",
  why: "Three of your last twenty reviews name the same problem and none of them have a reply. Unanswered complaints about one specific thing read as a pattern to anyone scanning your listing.",
  validation: "Based on 3 of your last 20 reviews (15%) mentioning wait times.",
  tags: [
    { axis: "what", label: "Google Business Profile" },
    { axis: "when", label: "This week" },
  ],
  confidence: "high",
  impact: "high",
  detailHref: "#",
  whyPoints: [
    "Three separate reviewers named the same problem inside your last twenty.",
    "None of the three has a reply, and reply rate is visible on your listing.",
    "All three landed on a Friday or Saturday.",
  ],
  evidence: [
    { label: "Review, four days ago", text: "Waited almost forty minutes for a table on a Friday with half the dining room empty." },
    { label: "Review, last week", text: "Food was great once it came. The wait was rough and nobody told us how long." },
  ],
  plan: [
    {
      channel: "Review replies",
      audience: "The three reviewers, by name",
      window: "This week, all three in one sitting",
      copy: "You are right that the wait ran long that night. We have added a host on Fridays. I would like to get you back in.",
    },
    {
      channel: "In-store",
      audience: "Friday and Saturday front of house",
      window: "Starting this Friday",
      offer: "Quote a real wait and hand out a pager rather than guessing",
    },
  ],
}

const PLAN_3: UnifiedInsight = {
  id: "p3",
  title: "Your patio is invisible in search and two competitors are ranking on it",
  why: "Outdoor seating does not appear anywhere on your listing or your site, and two of the places you watch are surfacing for patio searches in your area.",
  validation: "Based on your listing attributes and 2 of the 5 competitors you watch.",
  tags: [
    { axis: "what", label: "Search visibility" },
    { axis: "when", label: "No rush" },
  ],
  confidence: "medium",
  impact: "medium",
  detailHref: "#",
  whyPoints: [
    "Your listing has no outdoor-seating attribute set.",
    "Two of the competitors you watch do, and both surface for patio searches nearby.",
  ],
  plan: [
    {
      channel: "Your Google Business Profile",
      window: "Once, takes about ten minutes",
      offer: "Turn on the outdoor seating attribute and add three patio photos",
    },
  ],
}

const PLAN_4: UnifiedInsight = {
  id: "p4",
  title: "Your menu photos are older than every competitor you watch",
  why: "The most recent photo on your listing predates every one of theirs. Photo recency is one of the few things a diner reads as a proxy for whether a place is still good.",
  validation: "Based on the newest photo on your listing against the five competitors you watch.",
  tags: [
    { axis: "what", label: "Visual intelligence" },
    { axis: "when", label: "This week" },
  ],
  confidence: "medium",
  impact: "medium",
  detailHref: "#",
  whyPoints: [
    "Every competitor you watch has a newer photo than your newest.",
    "Two of them have posted new photos in the last month.",
  ],
  plan: [
    {
      channel: "Your Google Business Profile",
      window: "One sitting, this week",
      offer: "Shoot and upload six current plates plus one room shot",
      creativeDirection: "Tight crop, warm side light, no flash",
    },
  ],
}

const PLAN_5: UnifiedInsight = {
  id: "p5",
  title: "A competitor started running a weekday lunch special you do not answer",
  why: "They posted a weekday lunch price last week and have repeated it twice. You have nothing at that price point on a weekday.",
  validation: "Based on three posts from one competitor over the last nine days.",
  tags: [
    { axis: "what", label: "Competitors" },
    { axis: "when", label: "This week" },
  ],
  confidence: "high",
  impact: "medium",
  detailHref: "#",
  whyPoints: [
    "Three posts in nine days, all naming the same weekday price.",
    "Your weekday menu has no comparable entry point.",
  ],
  plan: [
    {
      channel: "In-store and your listing",
      window: "Decide this week, live next Monday",
      offer: "One weekday plate at a comparable price, or a reason yours costs more",
    },
  ],
}

/* ── Tier 2: a single generic line and nothing behind it. 9,372 rows look like this. ── */
const SUGGESTION_1: UnifiedInsight = {
  id: "s1",
  title: "Your posting has been quiet for eleven days",
  why: "Your last post went up eleven days ago. Two of the places you watch have posted six times in that window.",
  validation: null,
  tags: [
    { axis: "what", label: "Social media" },
    { axis: "when", label: "This week" },
  ],
  confidence: "medium",
  impact: "low",
  detailHref: "#",
  whyPoints: [
    "Your last post is eleven days old.",
    "Two of the accounts you watch posted six times in the same window.",
  ],
  suggestion: "Resume posting with behind-the-scenes or seasonal content.",
}

const SUGGESTION_2: UnifiedInsight = {
  id: "s2",
  title: "One post did roughly four times your normal engagement",
  why: "A post from last Tuesday reached well past your usual range. We do not have enough history yet to say what carried it.",
  validation: null,
  tags: [{ axis: "what", label: "Social media" }],
  confidence: "directional",
  impact: "low",
  detailHref: "#",
  whyPoints: [
    "One post cleared roughly four times your usual engagement.",
    "We do not have enough posting history yet to say which element carried it.",
  ],
  suggestion: "Study what made this content perform well.",
}

/* ── Tier 3: an observation. No recommendation exists, so the card shows no action. ── */
const OBSERVATION_1: UnifiedInsight = {
  id: "o1",
  title: "A competitor two blocks over changed their hours on weekends",
  why: "They now close at 9pm on Sundays instead of 11pm. Not enough has happened yet for us to tell you what to do about it.",
  validation: null,
  tags: [
    { axis: "what", label: "Google Business Profile" },
    { axis: "when", label: "No rush" },
  ],
  confidence: "directional",
  impact: "low",
  detailHref: "#",
  whyPoints: [
    "Their posted Sunday closing time moved earlier.",
    "One change on one day is not yet a pattern we would act on.",
  ],
}

const OBSERVATION_2: UnifiedInsight = {
  id: "o2",
  title: "Rain forecast Thursday through Saturday",
  why: "Three days of rain in your area this week.",
  validation: null,
  tags: [{ axis: "what", label: "Weather" }],
  confidence: "high",
  impact: "low",
  detailHref: "#",
}

export default function UnifiedInsightCardPreview() {
  return (
    // `tk-kit` is the kit's reset scope (box-sizing, button reset, svg display). Every
    // surface that mounts kit components wraps them in it.
    <div className="pv-page pic tk-kit">
      <div className="pv-page-head">
        {/* The card is entirely token-based, so it has to be judged in both themes. Reuses
            the operator shell's own ThemeToggle (next-themes) rather than a local one, so
            the switch here behaves exactly like the switch in the real app. */}
        <div className="pic-topbar">
          <span className="pv-kicker">Proposal</span>
          <ThemeToggle className="pv-theme-btn" />
        </div>
        <h1 className="pv-h1">One insight card</h1>
        <p className="pv-sub">
          One component for the home brief, the all-insights view and /insights. It degrades by
          what the record can actually back, so it never promises a plan that is not there. Keep,
          Dismiss and the plan disclosure are live, so click them. The toggle top-right switches
          light and dark.
        </p>
      </div>
      <hr className="pv-rule" />

      {/* ═══ 1. THE THREE TIERS ═══ */}
      <section className="pic-sec">
        <h2 className="pic-h2">1 · The three tiers, same card</h2>
        <p className="pic-note">
          Tier is derived from the data present, never stored, so it can never disagree with what
          the card is showing.
        </p>

        <div className="pic-tier">
          <div className="pic-tier-label">
            <b>Has a plan</b>
            <span>1,377 records. Real recipe: channel, who, when, offer, copy. Gets the action region and &ldquo;See the plan&rdquo;.</span>
          </div>
          <div className="pic-one"><UnifiedInsightCard insight={PLAN_2} /></div>
        </div>

        <div className="pic-tier">
          <div className="pic-tier-label">
            <b>Suggestion only</b>
            <span>9,372 records. One generic line, no steps, no cited evidence. Region is labelled &ldquo;Suggested next step&rdquo;, singular, and there is no &ldquo;See the plan&rdquo; to press.</span>
          </div>
          <div className="pic-one"><UnifiedInsightCard insight={SUGGESTION_1} /></div>
        </div>

        <div className="pic-tier">
          <div className="pic-tier-label">
            <b>Observation</b>
            <span>2,005 records. No recommendation exists, so the card renders NO action region at all. An empty labelled region would just advertise the absence.</span>
          </div>
          <div className="pic-one"><UnifiedInsightCard insight={OBSERVATION_1} /></div>
        </div>
      </section>

      {/* ═══ 2. TAGS ═══ */}
      <section className="pic-sec">
        <h2 className="pic-h2">2 · Tags: the axis picks the colour</h2>
        <p className="pic-note">
          <b>What</b> it is about is slate, <b>when</b> it matters is rust, <b>state</b> in the
          product is teal. Hierarchy inside the time axis comes from weight, filled versus
          outlined, never a second colour. The tags and the scores share one row, so the card
          below with a single tag does not strand a whole line on one chip.
        </p>
        <div className="pic-two">
          <UnifiedInsightCard insight={PLAN_LEAD} />
          <UnifiedInsightCard insight={OBSERVATION_2} />
        </div>
        <p className="pic-note">
          Urgency wording is now one axis end to end: <b>Next day or two</b> / <b>This week</b> /{" "}
          <b>No rush</b>. That replaces the mixed set (&ldquo;High priority&rdquo; was a priority
          word sitting between two time words) and it replaces the briefing&rsquo;s
          &ldquo;Act in 24-48h&rdquo;, which said the same thing in different words.
        </p>
      </section>

      {/* ═══ 2b. THE BUTTON FRAMEWORK (ALT-252 pulled forward) ═══ */}
      <section className="pic-sec">
        <h2 className="pic-h2">2b · Buttons: three tiers, three states</h2>
        <p className="pic-note">
          Pulled forward from the outstanding button ticket, since the card is the most
          button-dense surface in the product. <b>Hover and click each one.</b> Nothing here is
          faked, it is the real CSS. Radius is <code>--r-sm</code> on every tier. Scoped to the
          card for now so it can be judged before it reskins the whole app. Full token values,
          contrast measurements and the light-versus-dark comparison live on{" "}
          <a href="/preview/palette">the palette page</a>.
        </p>
        <div className="pic-btnspec">
          <div className="pic-btnrow">
            <div className="pic-btnlabel">
              <b>Primary</b>
              <span>
                Rust fill, <code>--card</code> label. Deepens to <code>--rust-deep</code> on hover,
                presses to <code>--press</code>. <b>This is what the card uses for &ldquo;See the
                plan&rdquo;</b>, which is the main action on any insight that has one.
              </span>
            </div>
            <div className="pic-btnset uic">
              <button type="button" className="uic-btn uic-btn-primary">See the plan</button>
            </div>
          </div>
          <div className="pic-btnrow">
            <div className="pic-btnlabel">
              <b>Secondary</b>
              <span>
                Neutral <code>--ledger</code> fill, <code>--ink</code> label, walking down the ink
                ramp on hover then press. A real alternative action. Not currently used by the card,
                since the card only has one main action.
              </span>
            </div>
            <div className="pic-btnset uic">
              <button type="button" className="uic-btn uic-btn-secondary">See the plan</button>
            </div>
          </div>
          <div className="pic-btnrow">
            <div className="pic-btnlabel">
              <b>Tertiary</b>
              <span>
                No fill and no outline at rest, so it is text until you touch it. Colour arrives on
                hover. Used for Keep and Undo.
              </span>
            </div>
            <div className="pic-btnset uic">
              <button type="button" className="uic-btn uic-btn-tertiary">Keep</button>
              <button type="button" className="uic-btn uic-btn-tertiary">Undo</button>
            </div>
          </div>
          <div className="pic-btnrow">
            <div className="pic-btnlabel">
              <b>Tertiary, danger</b>
              <span>Same tier, no colour at rest so a destructive verb never shouts. Red only on hover.</span>
            </div>
            <div className="pic-btnset uic">
              <button type="button" className="uic-btn uic-btn-tertiary uic-btn-danger">Dismiss</button>
            </div>
          </div>
          <div className="pic-btnrow">
            <div className="pic-btnlabel">
              <b>Toggle</b>
              <span>Two frames of one control. Frame one is a tertiary button; frame two is the committed state, filled and inverted.</span>
            </div>
            <div className="pic-btnset uic">
              <button type="button" className="uic-btn uic-btn-tertiary">Keep</button>
              <span className="pic-arrow" aria-hidden="true">&rarr;</span>
              <button type="button" className="uic-btn uic-btn-toggle-on" aria-pressed="true">Kept</button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 3. ON HOME ═══ */}
      <section className="pic-sec">
        <h2 className="pic-h2">3 · On the home brief</h2>
        <p className="pic-note">
          Home shows <b>only insights that have a plan</b>: the hero plus four, five in all, same
          as today. Observations never appear here, so the brief keeps one promise, that everything
          on it is runnable. The hero keeps its image, which is the only thing giving the page
          visual relief when an operator lands on it.
        </p>
        <div className="pic-home">
          <UnifiedInsightCard
            insight={PLAN_LEAD}
            variant="lead"
            photo={<PassHeroCanvas family="competitive" label="Your location" />}
          />
          <div className="pic-two">
            <UnifiedInsightCard insight={PLAN_2} />
            <UnifiedInsightCard insight={PLAN_3} />
            <UnifiedInsightCard insight={PLAN_4} />
            <UnifiedInsightCard insight={PLAN_5} />
          </div>
          <a className="pic-seeall" href="#all">See all insights &rarr;</a>
        </div>
      </section>

      {/* ═══ 4. VIEW ALL ═══ */}
      <section className="pic-sec" id="all">
        <h2 className="pic-h2">4 · The all-insights view</h2>
        <p className="pic-note">
          One page, no tabs. Two sections in a fixed order, and the second one is honest about why
          it is second. Each section batches six at a time, the same reveal that shipped on
          /insights.
        </p>

        <div className="pic-allsec">
          <div className="pic-sechead">
            <h3>Ready to act on</h3>
            <span>Each of these comes with a step-by-step plan.</span>
          </div>
          <div className="pic-two">
            <UnifiedInsightCard insight={PLAN_2} />
            <UnifiedInsightCard insight={PLAN_3} />
          </div>
          <button type="button" className="pic-more">Show 6 more<span>34 left</span></button>
        </div>

        <div className="pic-allsec">
          <div className="pic-sechead">
            <h3>Observations</h3>
            <span>We spotted these. There is no plan behind them yet.</span>
          </div>
          <div className="pic-two">
            <UnifiedInsightCard insight={SUGGESTION_1} />
            <UnifiedInsightCard insight={SUGGESTION_2} />
            <UnifiedInsightCard insight={OBSERVATION_1} />
            <UnifiedInsightCard insight={OBSERVATION_2} />
          </div>
          <button type="button" className="pic-more">Show 6 more<span>212 left</span></button>
        </div>
      </section>

      {/* ═══ 5. THE WIRED CARD ═══ */}
      <section className="pic-sec">
        <h2 className="pic-h2">5 · The wired card, as /home now renders it</h2>
        <p className="pic-note">
          Everything above is a fixture typed by hand. <b>This section is the real thing</b>: one
          fixture play from the engine, run through the real adapter into the real{" "}
          <code>&lt;BriefInsightCard/&gt;</code> that the daily brief mounts. So it shows what
          actually ships, including the parts a hand-written fixture cannot prove.
        </p>
        <ul className="pic-note pic-checklist">
          <li>
            <b>Nothing was lost in the swap.</b> The sentiment bars, the verbatim review quote, the
            win-flag beside both scores, the drafted copy with its copy button and every recipe-step
            field including <i>Needs</i> all survive. Open the plan to see them.
          </li>
          <li>
            <b>The timing chip is derived from a real date.</b> The first step carries a window that
            starts Saturday, so the card says so. A step with only a prose note gets no timing chip
            at all, because there would be no date behind it.
          </li>
          <li>
            <b>The validation line is denominated.</b> &ldquo;3 of 20 reviews&rdquo; comes from the
            cited evidence rate, not from a confidence score.
          </li>
          <li>
            <b>The title renders its accent.</b> The fixture title carries model markup, and the
            card runs it through <code>accentize</code> rather than printing the brackets.
          </li>
        </ul>
        <TkToastProvider>
          <div className="ticket-brief tk-kit pic-home">
            <TkTooltipLayer />
            <BriefInsightCard
              play={FIXTURE_PLAY}
              isLead
              locationId="preview"
              dateKey="2026-07-30"
              playKey="preview:lead"
              current={null}
              detailHref="#"
              heroPhoto={<PassHeroCanvas family="competitive" label="Your location" />}
            />
            <div className="pic-two">
              <BriefInsightCard
                play={FIXTURE_PLAY}
                isLead={false}
                locationId="preview"
                dateKey="2026-07-30"
                playKey="preview:grid"
                current={null}
                detailHref="#"
              />
              <BriefInsightCard
                play={{ ...FIXTURE_PLAY, recipe: [], presentation: undefined, evidence: [] }}
                isLead={false}
                locationId="preview"
                dateKey="2026-07-30"
                playKey="preview:norecipe"
                current="saved"
                detailHref="#"
              />
            </div>
          </div>
        </TkToastProvider>
        <p className="pic-note">
          The second grid card is the honest-degradation case: same play with its recipe, evidence
          and presentation stripped. It drops to an observation with no action region, no timing
          chip and no validation line, rather than showing an empty &ldquo;The plan&rdquo; box. It
          is also already kept, which is the second frame of that toggle.
        </p>
      </section>
    </div>
  )
}
