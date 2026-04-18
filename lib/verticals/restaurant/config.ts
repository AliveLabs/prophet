import type { VerticalConfig } from "../types"
import { CUISINES, CATEGORY_EMOJIS, CONTENT_DISCOVERY_TERMS } from "./constants"

export const restaurantConfig: VerticalConfig = {
  industryType: "restaurant",
  displayName: "Ticket",

  labels: {
    businessLabel: "restaurant",
    businessLabelPlural: "restaurants",
    businessLabelCapitalized: "Restaurant",
    competitorLabel: "restaurant",
    competitorLabelPlural: "restaurants",
    categoryLabel: "Cuisine Type",
    ownerLabel: "Restaurant Owner",
    setupCta: "Set up my restaurant",
  },

  businessCategories: [...CUISINES],
  categoryEmojis: { ...CATEGORY_EMOJIS },

  onboarding: {
    splash: {
      title: "Welcome to Ticket",
      subtitle: "Competitive intelligence for restaurants",
      ctaLabel: "Set up my restaurant",
    },
    businessInfo: {
      title: "Your Restaurant",
      namePlaceholder: "e.g. The Rustic Fork",
      categoryPlaceholder: "Select cuisine type",
      categoryLabel: "Cuisine Type",
    },
    competitors: {
      searchingLabel: "Searching for nearby restaurants...",
      foundLabel: "We found nearby restaurants. Pick up to 5 to track.",
      emptyLabel: "No nearby restaurants found. Add them manually.",
      selectLabel: "Select up to 5 competitors",
    },
    settings: {
      newCompetitorLabel: "Get alerted when new restaurants open nearby",
      reviewThresholdLabel: "Notify me when a competitor's reviews shift",
      contentChangeLabel: "Track menu and pricing changes",
    },
    brief: {
      title: "Building your first brief",
      subtitle: "We're scanning the competitive landscape now",
      ctaLabel: "Go to dashboard",
    },
  },

  emailCopy: {
    welcome: {
      subject: "Welcome to Ticket — your intelligence is live",
      headline: "Your restaurant is being watched (in a good way)",
      intro: "We're scanning your competitors daily. Your first weekly briefing will land in 7 days.",
      tipHeader: "Quick tip",
      tipBody: "Check the Insights tab for any menu or pricing moves we've already spotted.",
    },
  },

  placesApiType: "restaurant",
  contentExtractor: "restaurant_menu",
  contentDiscoveryTerms: [...CONTENT_DISCOVERY_TERMS],
  contentFeatures: [
    {
      key: "reservations",
      label: "Online Reservations",
      detectionPatterns: ["reserve", "book a table", "opentable", "resy"],
    },
    {
      key: "onlineOrdering",
      label: "Online Ordering",
      detectionPatterns: ["order online", "online order", "place an order", "toasttab", "chownow"],
    },
    {
      key: "privateDining",
      label: "Private Dining",
      detectionPatterns: ["private dining", "private event", "private room", "banquet"],
    },
    {
      key: "catering",
      label: "Catering",
      detectionPatterns: ["catering", "cater", "large order", "group order"],
    },
    {
      key: "happyHour",
      label: "Happy Hour",
      detectionPatterns: ["happy hour", "drink special", "weekday special"],
    },
    {
      key: "doordash",
      label: "DoorDash",
      detectionPatterns: ["doordash"],
    },
    {
      key: "ubereats",
      label: "Uber Eats",
      detectionPatterns: ["uber eats", "ubereats"],
    },
    {
      key: "grubhub",
      label: "Grubhub",
      detectionPatterns: ["grubhub"],
    },
  ],
  contentInsightModule: "restaurant",

  signals: {
    competitor: true,
    seo: true,
    events: true,
    content: true,
    photos: true,
    traffic: true,
    weather: true,
    social: true,
  },

  llmContext: {
    businessDescription:
      "a local restaurant operator competing with other nearby restaurants",
    competitorDescription:
      "nearby restaurants serving similar cuisine and clientele",
    industryVocabulary: [
      "menu",
      "cuisine",
      "chef",
      "dine-in",
      "takeout",
      "catering",
      "happy hour",
    ],
  },

  brand: {
    dataBrand: "ticket",
    wordmark: "ticket",
    displayName: "Ticket",
    tagline: "Read the ticket.",
  },
}
