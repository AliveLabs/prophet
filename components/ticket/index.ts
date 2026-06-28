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
  TkHero,
  TkPlayCard,
  TkWidgetGrid,
  TkWidget,
  TkWidgetRow,
} from "./layout-blocks"
export type { TkWidgetTone, TkWidgetSize } from "./layout-blocks"

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

// toast (client)
export { TkToast, TkToastProvider, useTkToast } from "./toast"

// tooltip (client)
export { TkTooltip, TkTooltipLayer } from "./tooltip"

// states (server-safe)
export { TkEmptyState, TkStillLearning } from "./states"
