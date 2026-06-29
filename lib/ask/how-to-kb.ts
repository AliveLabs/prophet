// Ask Ticket — the platform HOW-TO knowledge base (ALT-203).
//
// A curated, typed content module (NOT a DB table) of how-to entries covering the
// main platform tasks: adding/swapping competitors, managing your own & competitor
// social handles, reading the brief, pinning a question, refreshing data, billing/plan,
// and inviting teammates. The Ask answering path (lib/ask/how-to.ts) answers
// platform/"how do I…" questions FROM this KB, grounded — never the open web, never
// invented UI that doesn't exist.
//
// Voice rules (match the rest of Ask): direct and plain, for a busy owner. No em
// dashes, no chef/kitchen jargon, no raw enum keys or vendor names. Steps are short
// and refer to on-screen labels the operator actually sees.
//
// To extend: add an entry. Keep `keywords` lowercase and broad (the classifier matches
// on these), keep `steps` to the literal clicks, and keep `answer` to a 2-3 sentence
// plain summary the model can lean on verbatim.

export type HowToEntry = {
  /** stable id (kebab-case) */
  id: string
  /** the canonical task, phrased as the operator would ask it */
  title: string
  /** lowercase match terms — the classifier scores a question against these */
  keywords: string[]
  /** a plain 2-3 sentence summary the answerer can use directly */
  answer: string
  /** the literal on-screen steps (labels the operator actually sees) */
  steps: string[]
  /** where in the product this lives (used as the cited "source" label) */
  where: string
}

export const HOW_TO_KB: HowToEntry[] = [
  {
    id: "add-competitor",
    title: "How do I add a competitor to watch?",
    keywords: [
      "add competitor", "add a competitor", "watch competitor", "track competitor",
      "new competitor", "competitor set", "watch a restaurant", "monitor competitor",
      "follow competitor", "add rival",
    ],
    answer:
      "Open Competitors from the left nav, then use Add competitor and search for the business by name. Once you confirm it, Ticket starts watching their reviews, social, and market signals and folds them into your brief.",
    steps: [
      "Go to Competitors in the left nav",
      "Click Add competitor",
      "Search for the business by name and pick the right one",
      "Confirm to start watching them",
    ],
    where: "Competitors",
  },
  {
    id: "swap-competitor",
    title: "How do I swap or remove a competitor?",
    keywords: [
      "swap competitor", "remove competitor", "delete competitor", "stop watching",
      "replace competitor", "change competitor", "drop competitor", "untrack competitor",
      "wrong competitor",
    ],
    answer:
      "Open Competitors, click the one you want to change, and use Stop watching to drop it from your set. To swap, drop the old one and add the new business with Add competitor.",
    steps: [
      "Go to Competitors in the left nav",
      "Open the competitor you want to change",
      "Use Stop watching to remove it from your set",
      "Add a replacement with Add competitor if you're swapping",
    ],
    where: "Competitors",
  },
  {
    id: "add-own-social-handle",
    title: "How do I add or manage my own social handles?",
    keywords: [
      "my social", "own handle", "add my handle", "my instagram", "my social handle",
      "connect social", "add social account", "watched accounts", "my accounts",
      "link instagram", "add my account", "manage my handles", "social handle",
    ],
    answer:
      "Your own social accounts live under Social, in Watched accounts. Use Add handle to enter your account, and Ticket will track it alongside your competitors so the brief can compare you to your set.",
    steps: [
      "Go to Social in the left nav",
      "Find Watched accounts",
      "Click Add handle and enter your account",
      "Save to start tracking it",
    ],
    where: "Social · Watched accounts",
  },
  {
    id: "add-competitor-social-handle",
    title: "How do I add a competitor's social handle?",
    keywords: [
      "competitor handle", "competitor social", "competitors social", "competitor instagram",
      "rival handle", "add competitor handle", "competitor account", "their instagram",
      "their handle", "competitors handle", "social handle", "their social",
    ],
    answer:
      "Open the competitor under Competitors and add their social account in the handles section, or use Watched accounts under Social. Ticket discovers likely handles for you, and you confirm the right one so the social comparison stays accurate.",
    steps: [
      "Go to Competitors and open the competitor (or open Social · Watched accounts)",
      "Find the social handles section",
      "Pick a discovered handle or add it by hand",
      "Confirm it to start tracking their social",
    ],
    where: "Competitors · Social · Watched accounts",
  },
  {
    id: "read-the-brief",
    title: "How do I read my daily brief?",
    keywords: [
      "read brief", "read the brief", "understand brief", "daily brief", "what is the brief",
      "how brief works", "how the brief works", "today page", "read my brief",
      "understand my brief", "brief mean", "how do i read", "what do the plays mean",
      "what is a play",
    ],
    answer:
      "Your brief is on Today and refreshes every morning. The top play is the most important move for the day, followed by ranked plays, with confidence pips showing how strong the signal is. Each play shows the signals behind it, and you can keep a play to act on it or remove it to tune what you see.",
    steps: [
      "Open Today in the left nav",
      "Start with the lead play at the top, then scan the ranked plays",
      "Check the confidence pips and the signals behind each play",
      "Keep a play to act on it, or remove it to tune future briefs",
    ],
    where: "Today",
  },
  {
    id: "pin-a-question",
    title: "How do I pin a question so it re-runs every morning?",
    keywords: [
      "pin question", "pin a question", "standing question", "re-run", "rerun", "every morning",
      "pin this", "pin answer", "save question", "recurring question", "daily question",
      "pin my question", "standing ask",
    ],
    answer:
      "On Ask, type your question and use Pin it under Standing question to make it re-run every morning with your brief. You can also pin a question right from an answer. The latest answer shows up on Ask and on your Today brief, and you can update or unpin it any time.",
    steps: [
      "Go to Ask in the left nav",
      "Type your question in the Standing question box and click Pin it",
      "Or ask a question, then use Pin this on the answer",
      "Find the morning answer on Ask and on your Today brief",
    ],
    where: "Ask · Standing question",
  },
  {
    id: "refresh-data",
    title: "How do I refresh my data?",
    keywords: [
      "refresh data", "refresh", "update data", "stale data", "out of date", "old data",
      "re-run data", "latest data", "data not updating", "force refresh", "sync data",
      "new data", "when does data update",
    ],
    answer:
      "Ticket refreshes on its own every morning, so a fresh brief is waiting for you each day. There's no manual refresh button. If something looks out of date, the brief flags which signal streams are fresh versus aging under What we checked.",
    steps: [
      "Open Today and check What we checked to see what is fresh versus aging",
      "Know that the brief rebuilds automatically every morning",
      "If a stream still looks stuck after a day, reach out and we'll look into it",
    ],
    where: "Today · What we checked",
  },
  {
    id: "billing-plan",
    title: "How do I manage my billing or plan?",
    keywords: [
      "billing", "manage plan", "change plan", "upgrade", "downgrade", "payment",
      "subscription", "invoice", "credit card", "trial", "cancel", "pricing", "my plan",
      "update card", "billing settings",
    ],
    answer:
      "Billing and your plan live in Settings under Billing. From there you can see your current plan, update your payment method, and change or cancel your subscription.",
    steps: [
      "Go to Settings in the left nav",
      "Open Billing",
      "Review your plan and update payment or change your subscription there",
    ],
    where: "Settings · Billing",
  },
  {
    id: "invite-teammates",
    title: "How do I invite teammates?",
    keywords: [
      "invite", "invite teammate", "add user", "add teammate", "add member", "team",
      "invite team", "add my manager", "share access", "add someone", "another user",
      "invite people", "team members",
    ],
    answer:
      "Invite teammates from Settings under Team. Use Invite, enter their email, and they'll get access to your location's brief and Ask.",
    steps: [
      "Go to Settings in the left nav",
      "Open Team",
      "Click Invite and enter their email address",
      "Send the invite",
    ],
    where: "Settings · Team",
  },
  {
    id: "manage-location",
    title: "How do I add or switch locations?",
    keywords: [
      "add location", "switch location", "another location", "second location", "new location",
      "change location", "multiple locations", "my location", "location settings",
    ],
    answer:
      "Locations are managed in Settings. Use the location switcher to move between them, and add a new one from your location settings. Each location gets its own brief, competitors, and Ask.",
    steps: [
      "Go to Settings in the left nav",
      "Open your location settings",
      "Use the switcher to change locations, or add a new one there",
    ],
    where: "Settings · Locations",
  },
  {
    id: "keep-remove-play",
    title: "How do I keep or remove a play, and does it teach Ticket?",
    keywords: [
      "keep play", "remove play", "dismiss play", "save play", "thumbs", "feedback",
      "teach ticket", "tune brief", "improve brief", "act on play", "snooze", "hide play",
      "rate play", "thumbs up", "thumbs down",
    ],
    answer:
      "On each play you can Keep it to act on it or Remove it to clear it, and you can give a thumbs up or down. Keeping and your thumbs teach Ticket what's useful so your future briefs get sharper. Removing just clears it for the day without penalizing that kind of play.",
    steps: [
      "Open Today and find the play",
      "Use Keep to act on it, or Remove to clear it",
      "Add a thumbs up or down to teach Ticket what's useful",
    ],
    where: "Today",
  },
]
