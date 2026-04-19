// Canonical marketing statistics shown across the landing page. Keeping a
// single source of truth prevents the hero ("10,000+ signals daily") and the
// trust strip ("10,000+ signals monitored daily") from drifting apart when
// copy is updated in one spot but forgotten in the other.

export type MarketingStat = {
  /** Numeric target used by animated counters. */
  value: number
  /** Suffix appended after the count (e.g. "+", "-day"). */
  suffix: string
  /** Optional prefix before the count. */
  prefix?: string
  /** Long-form label used on the trust strip. */
  label: string
  /** Short label used on the hero strip. */
  shortLabel: string
}

export const MARKETING_STATS = {
  signalsDaily: {
    value: 10000,
    suffix: "+",
    prefix: "",
    label: "Signals Monitored Daily",
    shortLabel: "Signals daily",
  },
  insightTypes: {
    value: 50,
    suffix: "+",
    prefix: "",
    label: "Insight Types Generated",
    shortLabel: "Insight types",
  },
  intelChannels: {
    value: 6,
    suffix: "",
    prefix: "",
    label: "Intelligence Channels",
    shortLabel: "Intel channels",
  },
  freeTrialDays: {
    value: 14,
    suffix: "-day",
    prefix: "",
    label: "Free Trial Included",
    shortLabel: "Free trial",
  },
} as const satisfies Record<string, MarketingStat>

export type MarketingStatKey = keyof typeof MARKETING_STATS
