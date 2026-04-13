export type IndustryType = "restaurant" | "liquor_store"

export interface FeatureDefinition {
  key: string
  label: string
  detectionPatterns: string[]
}

export interface VerticalConfig {
  industryType: IndustryType
  displayName: string

  labels: {
    businessLabel: string
    businessLabelPlural: string
    businessLabelCapitalized: string
    competitorLabel: string
    competitorLabelPlural: string
    categoryLabel: string
    ownerLabel: string
    setupCta: string
  }

  businessCategories: string[]
  categoryEmojis: Record<string, string>

  onboarding: {
    splash: {
      title: string
      subtitle: string
      ctaLabel: string
    }
    businessInfo: {
      title: string
      namePlaceholder: string
      categoryPlaceholder: string
      categoryLabel: string
    }
    competitors: {
      searchingLabel: string
      foundLabel: string
      emptyLabel: string
      selectLabel: string
    }
    settings: {
      newCompetitorLabel: string
      reviewThresholdLabel: string
      contentChangeLabel: string
    }
    brief: {
      title: string
      subtitle: string
      ctaLabel: string
    }
  }

  emailCopy: {
    welcome: {
      subject: string
      headline: string
      intro: string
      tipHeader: string
      tipBody: string
    }
  }

  placesApiType: string
  contentExtractor: "restaurant_menu" | "liquor_catalog"
  contentDiscoveryTerms: string[]
  contentFeatures: FeatureDefinition[]
  contentInsightModule: "restaurant" | "liquor_store"

  signals: {
    competitor: boolean
    seo: boolean
    events: boolean
    content: boolean
    photos: boolean
    traffic: boolean
    weather: boolean
    social: boolean
  }

  llmContext: {
    businessDescription: string
    competitorDescription: string
    industryVocabulary: string[]
  }
}
