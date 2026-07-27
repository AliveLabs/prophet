// The Pass — shared UI component kit barrel.
// Import the stylesheet once at the app shell: `import "@/components/ticket/pass.css"`.
// (It is wired in app/(dashboard)/layout.tsx.)

// reveal / hooks
export { RevealOnView } from "./reveal-on-view"
export { useInView } from "./use-in-view"

// presentational primitives (server-safe)
export {
  TkButton,
  TkChip,
  TkConfidence,
  TkWinFlag,
  TkCard,
  TkSoftPanel,
  TkSectionHead,
  TkVizCap,
  TkPhotoFallback,
  TkCompetitorLink,
  tkcx,
} from "./primitives"
export type {
  TkFamily,
  TkButtonVariant,
  TkConfidenceLevel,
} from "./primitives"

// layout blocks (server-safe)
export {
  TkActions,
  TkImpactTag,
  TkHero,
  TkPlayCard,
  TkWidgetGrid,
  TkWidget,
  TkWidgetRow,
} from "./layout-blocks"
export type { TkWidgetTone, TkWidgetSize, TkImpactLevel } from "./layout-blocks"

// interactive viz islands (client)
export {
  TkRangeBar,
  TkSentimentRows,
  TkNumBig,
  TkH2HBars,
  TkWindowViz,
  TkWeatherStrip,
  TkSocialEmbed,
  TkQuote,
} from "./viz"
export type { TkSentimentTone, TkWeatherIcon, TkDemand } from "./viz"

// why rolldown (client)
export { TkWhy } from "./why"

// drawer (client)
export { TkDrawer } from "./drawer"

// dismiss-reason popover (client)
export { TkDismissReason, TK_DEFAULT_DISMISS_REASONS } from "./dismiss-reason"

// "Ask Ticket about this" T-bubble on viz cards (client) — ALT-230
export { VizTBubble, buildAskQuestion } from "./viz-tbubble"
export type { VizContext, VizDomain } from "./viz-tbubble"

// "Ask Ticket about this" ask-only ingress for play detail (ALT-259)
export { AskTicket } from "./ask-ticket" // client component (node)
export { askStepQuestion, askEvidenceQuestion } from "./ask-question" // server-safe helpers

// competitor "sonar" motif (server-safe SVG) — ALT-241
export { TkSonar } from "./sonar"

// social channel badge for insight cards (server-safe) — ALT-372
export { SocialChannelChip } from "./social-channel-chip"

// toast (client)
export { TkToast, TkToastProvider, useTkToast } from "./toast"

// tooltip (client)
export { TkTooltip, TkTooltipLayer } from "./tooltip"

// states (server-safe)
export { TkEmptyState, TkStillLearning } from "./states"
