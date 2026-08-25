// The FICTIONAL brief behind /example-brief — the public example page AND the source the
// marketing site's product imagery is captured from.
//
// Bryan, 2026-08-25: the marketing site must demonstrate the ACTUAL appearance of a brief (the
// real BriefView layout), not a hand-drawn approximation. This fixture is a complete,
// honest-shaped Brief for a fictional restaurant, weighted toward marketing and social insights,
// rendered through the real components so /example-brief IS the current product. Regenerate the
// marketing screenshots from that route whenever the brief UI changes.
//
// Everything here is invented and must stay obviously so:
//   · "Copper Fern" and every competitor are fictional businesses. Never swap in a real one.
//   · Every number is internally consistent (rates carry denominators, engagement is %-framed)
//     and follows the live voice rules: operator language, no kitchen lingo, no vendor names,
//     no revenue promises, no em dashes.
//   · Dates are computed from "now" so the mockup always reads current and the timing chips
//     ("Tomorrow", "By Saturday") stay alive without hand-editing.

import type { Brief, BriefCoverage, EnrichedRecommendation } from "@/lib/skills/types"
import type { MarketPulse } from "@/lib/insights/market-pulse"

export const MOCK_RESTAURANT = "Copper Fern"
export const MOCK_CITY = "Dallas"

export const MOCK_COMPETITORS = [
  "Beacon & Vine",
  "Casa Marisol",
  "The Gilded Spoon",
  "Northside Provisions",
  "Tumbleweed Social",
] as const

function keyOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysFrom(now: Date, n: number): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + n)
  return d
}

/** The next occurrence of a weekday (0=Sunday..6=Saturday), at least 2 days out so the
 *  chip renders as a named day ("By Saturday") rather than collapsing into Today/Tomorrow. */
function nextWeekday(now: Date, weekday: number): Date {
  const d = new Date(now)
  let add = (weekday - d.getDay() + 7) % 7
  if (add < 2) add += 7
  d.setDate(d.getDate() + add)
  return d
}

export function buildMockPlays(now: Date): EnrichedRecommendation[] {
  const tomorrow = keyOf(daysFrom(now, 1))
  const weekend = keyOf(daysFrom(now, 3))
  const saturday = keyOf(nextWeekday(now, 6))

  const lead: EnrichedRecommendation = {
    title: "Beacon & Vine's patio video is their best post this month. Your patio at sunset can answer it.",
    rationale:
      "Their short patio video is earning about 4x their typical engagement, so the audience for patio content is active right now. You have the better sunset view and a happy hour to point at, and nothing on your feed shows either this month.",
    skillId: "social-counter",
    ownerRole: "marketing",
    kind: "capitalize",
    stance: "capture",
    category: "social",
    confidence: "high",
    combinedScore: 86,
    leverage: { label: "high", basisInternal: "engagement delta vs own baseline; internal only" },
    evidenceRefs: [
      "social.competitor_post:beacon-and-vine-patio",
      "social.engagement_trend:beacon-and-vine",
      "social.own_cadence:posting-gap",
    ],
    evidence: [
      {
        relativeStat: "Their patio video is earning about 4x their typical engagement",
        soWhat: "the audience for patio content is active in your market right now",
        source: "social.engagement_trend:beacon-and-vine",
      },
    ],
    recipe: [
      {
        channel: "Instagram Reels",
        platforms: ["Instagram"],
        audience: "Your followers, plus nearby diners browsing patio spots for the weekend",
        window: { start: tomorrow, end: weekend, note: "Post before the weekend" },
        copy: "Golden hour on the patio. Misters on, spritzes cold, corner tables open. We hold happy hour 4 to 6, Friday through Sunday.",
        creativeDirection:
          "Fifteen seconds at sunset from the patio rail: warm side light, one slow pan across full tables, end on the drink pour.",
      },
      {
        channel: "Google Business Profile",
        platforms: ["Google Business"],
        audience: "Diners searching patio dining near you this weekend",
        window: { start: tomorrow, end: weekend, note: "Same day as the video" },
        copy: "Patio season is on. Shaded seating, happy hour 4 to 6, Friday through Sunday. Walk-ins welcome.",
      },
    ],
    knowledgeVersion: "mock",
    presentation: {
      exemplarSocialPost: {
        competitor: "Beacon & Vine",
        platform: "instagram",
        mediaUrl: "/dev-mock/beacon-vine-patio.svg",
        caption: "Patio nights are back. Spritz hour, 4 to 6.",
        engagementPct: 6.4,
        likes: 412,
        comments: 38,
        source: "social.competitor_post:beacon-and-vine-patio",
        focalPoint: { x: 0.5, y: 0.45 },
      },
      headToHead: [
        {
          metric: "social engagement",
          you: "1.4% per post",
          setOrCompetitor: "3.1% at Beacon & Vine",
          lead: "them",
          label: "Their posts are earning engagement at about twice your rate this month",
        },
      ],
      confidenceBasis: [
        {
          source: "Competitor social",
          whatWeSaw: "4 of their last 6 posts feature the patio, and each ran above their monthly average",
        },
        {
          source: "Your social",
          whatWeSaw: "Your last patio post ran 3 weeks ago and beat your own average by half",
        },
      ],
    },
  }

  const cadence: EnrichedRecommendation = {
    title: "Your feed went quiet: 2 posts in the last 30 days against a set average of 9.",
    rationale:
      "Every competitor you track posted more than you this month, and feeds reward a steady pace. One planning pass can queue two weeks of posts from photos you already have.",
    skillId: "marketing-cadence",
    ownerRole: "marketing",
    kind: "prepare",
    stance: "fix",
    category: "marketing",
    confidence: "high",
    combinedScore: 74,
    leverage: { label: "medium", basisInternal: "cadence vs set; internal only" },
    evidenceRefs: ["social.own_cadence:posting-gap", "social.set_cadence:tracked-competitors"],
    evidence: [
      {
        relativeStat: "2 posts from you in 30 days, against a set average of 9",
        soWhat: "regulars are seeing your competitors in their feed, not you",
        source: "social.set_cadence:tracked-competitors",
      },
    ],
    recipe: [
      {
        channel: "Content calendar",
        platforms: ["Instagram", "Facebook"],
        audience: "Regulars who have not seen you in their feed this month",
        window: { start: tomorrow, note: "One planning pass this week" },
        copy: "Start with what already works: your three most-liked photos this year were all food close-ups. Queue two per week.",
        creativeDirection: "Reuse your strongest existing photos before shooting anything new.",
      },
    ],
    knowledgeVersion: "mock",
    presentation: {
      headToHead: [
        {
          metric: "posting pace",
          you: "2 posts in 30 days",
          setOrCompetitor: "9 across your tracked set",
          lead: "them",
          label: "Every competitor you track out-posted you this month",
        },
      ],
      confidenceBasis: [
        { source: "Your social", whatWeSaw: "2 posts in the last 30 days, both in the first week" },
        { source: "Competitor social", whatWeSaw: "All 5 tracked competitors posted at least 6 times in the same window" },
      ],
    },
  }

  const patioReviews: EnrichedRecommendation = {
    title: "Reviewers keep naming your patio at sunset. Put it in front of people who have never been in.",
    rationale:
      "Your guests are already writing the ad copy. Sunset on the patio shows up again and again in recent reviews, and none of your public photos or posts lead with it.",
    skillId: "review-marketing",
    ownerRole: "marketing",
    kind: "capitalize",
    stance: "capture",
    category: "marketing",
    confidence: "high",
    combinedScore: 71,
    leverage: { label: "medium", basisInternal: "review theme frequency; internal only" },
    evidenceRefs: ["reviews.theme:patio-sunset", "reviews.velocity:own"],
    evidence: [
      {
        rate: { numerator: 9, denominator: 24, pct: 38 },
        source: "reviews.theme:patio-sunset",
      },
    ],
    recipe: [
      {
        channel: "Instagram",
        platforms: ["Instagram"],
        audience: "Nearby diners who have never visited",
        window: { start: weekend, note: "Pin it after posting" },
        copy: "“Sunset here is unreal.” Your words, not ours. The patio opens at 4.",
        creativeDirection: "One wide patio shot at golden hour, tables full, no filter stack.",
      },
    ],
    knowledgeVersion: "mock",
    presentation: {
      advantage: true,
      breakoutQuotes: [
        {
          text: "We came for the tacos and stayed two extra hours on that patio. Sunset here is unreal.",
          source: "reviews.theme:patio-sunset",
          rating: 5,
          date: keyOf(daysFrom(now, -6)),
        },
        {
          text: "Best patio in the neighborhood, hands down. Ask for the shaded corner table.",
          source: "reviews.theme:patio-sunset",
          rating: 5,
          date: keyOf(daysFrom(now, -11)),
        },
      ],
      confidenceBasis: [
        { source: "Reviews", whatWeSaw: "9 of your last 24 reviews mention the patio, all of them positive" },
      ],
    },
  }

  const giveaway: EnrichedRecommendation = {
    title: "Casa Marisol is trading a giveaway for customer photos, and their tag mentions doubled.",
    rationale:
      "They are turning guests into their photographers. A table card asking for one photo, with a story reshare as the thank-you, gets you the same engine without discounting anything.",
    skillId: "social-counter",
    ownerRole: "marketing",
    kind: "capitalize",
    stance: "capture",
    category: "social",
    confidence: "medium",
    combinedScore: 66,
    leverage: { label: "medium", basisInternal: "tag-mention delta; internal only" },
    evidenceRefs: ["social.competitor_campaign:casa-marisol-giveaway", "social.tag_mentions:casa-marisol"],
    evidence: [
      {
        relativeStat: "Mentions tagging Casa Marisol roughly doubled since the giveaway started",
        soWhat: "guest photos are doing their posting for them",
        source: "social.tag_mentions:casa-marisol",
      },
    ],
    recipe: [
      {
        channel: "In-store",
        platforms: ["Instagram"],
        audience: "Guests already seated, phones already out",
        window: { start: saturday, note: "Print for the weekend" },
        copy: "Took a photo you like? Tag us and we will reshare our favorites every Sunday.",
        creativeDirection: "A small table card, same type as the menu, no hashtag pile.",
      },
    ],
    knowledgeVersion: "mock",
    presentation: {
      confidenceBasis: [
        { source: "Competitor social", whatWeSaw: "The giveaway post is pinned and tagged guest photos doubled in two weeks" },
      ],
    },
  }

  const market: EnrichedRecommendation = {
    title: "The Saturday farmers market two blocks over is your cheapest brunch audience this week.",
    rationale:
      "Foot traffic within a short walk of your door peaks Saturday morning while your dining room sits quiet until noon. A sidewalk sign and one morning story are the whole play.",
    skillId: "local-demand",
    ownerRole: "marketing",
    kind: "capitalize",
    stance: "capture",
    category: "demand",
    confidence: "directional",
    combinedScore: 58,
    leverage: { label: "low", basisInternal: "foot-traffic proximity; internal only" },
    evidenceRefs: ["events.recurring:farmers-market", "traffic.weekend_morning:own-block"],
    evidence: [
      {
        relativeStat: "Saturday morning foot traffic near your block runs well above your own morning seatings",
        soWhat: "people are already walking past while your tables sit open",
        source: "traffic.weekend_morning:own-block",
      },
    ],
    recipe: [
      {
        channel: "In-store",
        platforms: ["Instagram"],
        audience: "Market visitors walking your block Saturday morning",
        window: { start: saturday, note: "Out by 9 AM Saturday" },
        copy: "Two blocks from the market. Iced coffee and breakfast tacos until noon.",
        creativeDirection: "Chalk sign at the corner, one story from the market crowd itself.",
      },
    ],
    knowledgeVersion: "mock",
  }

  return [lead, cadence, patioReviews, giveaway, market]
}

export function buildMockCoverage(now: Date): BriefCoverage[] {
  const today = keyOf(now)
  const fresh = (label: string, detail?: string): BriefCoverage => ({
    label,
    present: true,
    asOf: today,
    ...(detail ? { detail } : {}),
  })
  return [
    fresh("Competitor social", "5 profiles read"),
    fresh("Reviews", "24 recent reviews"),
    fresh("Competitor menus", "5 menus compared"),
    fresh("Local search", "Rankings refreshed"),
    fresh("Local events", "Next 14 days"),
    fresh("Weather", "Weekend outlook"),
    { label: "Foot traffic", present: true, stale: true, asOf: keyOf(daysFrom(now, -3)) },
    fresh("Listing photos", "Yours and the set"),
  ]
}

export function buildMockBrief(now: Date): Brief {
  const asOf = new Date(now)
  asOf.setHours(6, 12, 0, 0)
  return {
    locationId: "00000000-0000-0000-0000-00000000mock",
    dateKey: keyOf(now),
    headline: "The set is winning [[Instagram]] this week. Your patio can take it back.",
    deck: "Two competitors are pushing patio content while your feed sits quiet. The audience is provably there, and you own the better sunset.",
    plays: buildMockPlays(now),
    asOf: asOf.toISOString(),
    coverage: buildMockCoverage(now),
  }
}

export function buildMockPulse(now: Date): MarketPulse {
  return {
    changes: [
      {
        id: "mock-change-1",
        competitorId: "mock-comp-1",
        competitorName: "Beacon & Vine",
        kind: "promo",
        what: "Pinned a patio happy hour promotion, Friday through Sunday",
        dateKey: keyOf(daysFrom(now, -1)),
      },
      {
        id: "mock-change-2",
        competitorId: "mock-comp-2",
        competitorName: "Casa Marisol",
        kind: "photos",
        what: "Added 12 new listing photos, most of them guest-submitted",
        dateKey: keyOf(daysFrom(now, -2)),
      },
      {
        id: "mock-change-3",
        competitorId: "mock-comp-3",
        competitorName: "The Gilded Spoon",
        kind: "hours",
        what: "Extended Friday and Saturday hours to midnight",
        dateKey: keyOf(daysFrom(now, -4)),
      },
    ],
    benchmark: {
      ownRating: 4.6,
      ownReviewCount: 412,
      medianRating: 4.3,
      comparedCount: 5,
      standing: "above",
    },
  }
}

export const MOCK_STANDING_ASK = {
  question: "What are my competitors promoting this weekend?",
  answer:
    "Two of the five are pushing their patios. Beacon & Vine pinned a happy hour video and Casa Marisol is running a photo giveaway through Sunday. Nothing new from the other three this week.",
}
