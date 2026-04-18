import type { VerticalConfig } from "../types"
import { STORE_TYPES, CATEGORY_EMOJIS, CONTENT_DISCOVERY_TERMS } from "./constants"

export const liquorStoreConfig: VerticalConfig = {
  industryType: "liquor_store",
  displayName: "Neat",

  labels: {
    businessLabel: "liquor store",
    businessLabelPlural: "liquor stores",
    businessLabelCapitalized: "Liquor Store",
    competitorLabel: "liquor store",
    competitorLabelPlural: "liquor stores",
    categoryLabel: "Store Type",
    ownerLabel: "Store Owner",
    setupCta: "Set up my store",
  },

  businessCategories: [...STORE_TYPES],
  categoryEmojis: { ...CATEGORY_EMOJIS },

  onboarding: {
    splash: {
      title: "Welcome to Neat",
      subtitle: "Competitive intelligence for liquor stores",
      ctaLabel: "Set up my store",
    },
    businessInfo: {
      title: "Tell us about your store",
      namePlaceholder: "Store name",
      categoryPlaceholder: "Select store type",
      categoryLabel: "Store Type",
    },
    competitors: {
      searchingLabel: "Searching for nearby liquor stores...",
      foundLabel: "We found nearby liquor stores. Pick up to 5 to track.",
      emptyLabel: "No nearby liquor stores found. Add them manually.",
      selectLabel: "Select up to 5 competitors",
    },
    settings: {
      newCompetitorLabel: "Get alerted when new liquor stores open nearby",
      reviewThresholdLabel: "Notify me when a competitor's reviews shift",
      contentChangeLabel: "Track catalog and pricing changes",
    },
    brief: {
      title: "Building your first brief",
      subtitle: "We're scanning the competitive landscape now",
      ctaLabel: "Go to dashboard",
    },
  },

  emailCopy: {
    welcome: {
      subject: "Welcome to Neat — your intelligence is live",
      headline: "Your store is being watched (in a good way)",
      intro: "We're scanning your competitors daily. Your first weekly briefing will land in 7 days.",
      tipHeader: "Quick tip",
      tipBody: "Check the Insights tab for any pricing moves we've already spotted.",
    },
  },

  placesApiType: "liquor_store",
  contentExtractor: "liquor_catalog",
  contentDiscoveryTerms: [...CONTENT_DISCOVERY_TERMS],
  contentFeatures: [
    {
      key: "curbsidePickup",
      label: "Curbside Pickup",
      detectionPatterns: ["curbside", "curb side", "pickup at curb"],
    },
    {
      key: "homeDelivery",
      label: "Home Delivery",
      detectionPatterns: ["home delivery", "same day delivery", "local delivery"],
    },
    {
      key: "loyaltyProgram",
      label: "Loyalty Program",
      detectionPatterns: ["rewards", "loyalty", "members"],
    },
    {
      key: "tastingEvents",
      label: "Tasting Events",
      detectionPatterns: ["tasting", "tasting events", "whiskey tasting", "wine tasting"],
    },
    {
      key: "bulkOrdering",
      label: "Bulk / Case Discounts",
      detectionPatterns: ["case discount", "bulk", "case"],
    },
    {
      key: "drizly",
      label: "Drizly",
      detectionPatterns: ["drizly"],
    },
    {
      key: "instacart",
      label: "Instacart",
      detectionPatterns: ["instacart"],
    },
    {
      key: "gopuff",
      label: "GoPuff",
      detectionPatterns: ["gopuff", "go puff"],
    },
  ],
  contentInsightModule: "liquor_store",

  signals: {
    competitor: true,
    seo: true,
    events: true,
    content: false,
    photos: true,
    traffic: true,
    weather: true,
    social: true,
  },

  llmContext: {
    businessDescription:
      "a local liquor store operator competing with other nearby liquor stores and alcohol retailers",
    competitorDescription:
      "nearby liquor stores, wine shops, and beverage retailers serving similar clientele",
    industryVocabulary: [
      "bourbon",
      "scotch",
      "tequila",
      "vodka",
      "gin",
      "rum",
      "wine",
      "beer",
      "spirits",
      "ABV",
      "proof",
      "case",
      "fifth",
      "handle",
    ],
  },

  brand: {
    dataBrand: "neat",
    wordmark: "neat",
    displayName: "Neat",
    tagline: "Intelligence, neat.",
  },
}
