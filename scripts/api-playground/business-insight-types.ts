/**
 * Types and JSON schema for the business insight system.
 * Used as input to the Gemini query and to constrain the response format.
 */

/** Time window to analyze: 1 day, 7 days, or 30 days back */
export type TimeRange = "1d" | "7d" | "30d";

/** User input for a business insight request */
export interface BusinessInsightInput {
  /** Parent company or brand (optional) */
  organizationName?: string;
  /** Name of the business */
  businessName: string;
  /** Type/category of business (e.g. "restaurant", "coffee shop", "retail") */
  businessType: string;
  /** Full address or location description */
  address: string;
  /** Optional city for disambiguation */
  city?: string;
  /** Optional state/region */
  state?: string;
  /** Optional postal/ZIP code */
  postalCode?: string;
}

/** Single competitor entry (up to 10) */
export interface Competitor {
  name: string;
  businessType: string;
  address: string;
  description: string;
  estimatedDistance?: string;
  strengths?: string[];
  weaknesses?: string[];
}

/** Local event (up to 10) */
export interface LocalEvent {
  name: string;
  date: string;
  venue: string;
  eventType: string;
  relevanceToBusiness: string;
  opportunity?: string;
}

/** Weather summary for the location */
export interface WeatherSummary {
  currentConditions: string;
  temperature?: string;
  forecastSummary: string;
  impactOnBusiness: string;
  recommendation?: string;
}

/** Sentiment for one business (yours or a competitor) */
export interface SentimentSummary {
  businessName: string;
  overallSentiment: "positive" | "neutral" | "negative" | "mixed";
  sentimentScore: number; // 0-100
  reviewSummary: string;
  socialMediaSummary?: string;
  commonThemes: string[];
  sampleQuotes?: string[];
  timeWindow: string; // e.g. "last 7 days"
}

/** Top-level actionable insight section */
export interface ActionableInsight {
  executiveSummary: string;
  priorities: string[]; // ordered list
  opportunities: string[];
  risks: string[];
  recommendedActions: string[];
  competitivePosition: string;
  nextSteps: string[];
}

/** Full structured response from Gemini */
export interface BusinessInsightResponse {
  requestContext: {
    businessName: string;
    businessType: string;
    location: string;
    timeRange: TimeRange;
    generatedAt: string; // ISO date
  };
  competitors: Competitor[];
  localEvents: LocalEvent[];
  weather: WeatherSummary;
  sentiment: {
    yourBusiness: SentimentSummary;
    competitors: SentimentSummary[];
  };
  actionableInsight: ActionableInsight;
}

/** JSON schema for Gemini response (OpenAPI 3.0 / JSON Schema subset) */
export const BUSINESS_INSIGHT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    requestContext: {
      type: "object",
      properties: {
        businessName: { type: "string" },
        businessType: { type: "string" },
        location: { type: "string" },
        timeRange: { type: "string", enum: ["1d", "7d", "30d"] },
        generatedAt: { type: "string" },
      },
      required: ["businessName", "businessType", "location", "timeRange", "generatedAt"],
    },
    competitors: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          businessType: { type: "string" },
          address: { type: "string" },
          description: { type: "string" },
          estimatedDistance: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
        },
        required: ["name", "businessType", "address", "description"],
      },
    },
    localEvents: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          date: { type: "string" },
          venue: { type: "string" },
          eventType: { type: "string" },
          relevanceToBusiness: { type: "string" },
          opportunity: { type: "string" },
        },
        required: ["name", "date", "venue", "eventType", "relevanceToBusiness"],
      },
    },
    weather: {
      type: "object",
      properties: {
        currentConditions: { type: "string" },
        temperature: { type: "string" },
        forecastSummary: { type: "string" },
        impactOnBusiness: { type: "string" },
        recommendation: { type: "string" },
      },
      required: ["currentConditions", "forecastSummary", "impactOnBusiness"],
    },
    sentiment: {
      type: "object",
      properties: {
        yourBusiness: {
          type: "object",
          properties: {
            businessName: { type: "string" },
            overallSentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
            sentimentScore: { type: "number" },
            reviewSummary: { type: "string" },
            socialMediaSummary: { type: "string" },
            commonThemes: { type: "array", items: { type: "string" } },
            sampleQuotes: { type: "array", items: { type: "string" } },
            timeWindow: { type: "string" },
          },
          required: ["businessName", "overallSentiment", "sentimentScore", "reviewSummary", "commonThemes", "timeWindow"],
        },
        competitors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              businessName: { type: "string" },
              overallSentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
              sentimentScore: { type: "number" },
              reviewSummary: { type: "string" },
              socialMediaSummary: { type: "string" },
              commonThemes: { type: "array", items: { type: "string" } },
              sampleQuotes: { type: "array", items: { type: "string" } },
              timeWindow: { type: "string" },
            },
            required: ["businessName", "overallSentiment", "sentimentScore", "reviewSummary", "commonThemes", "timeWindow"],
          },
        },
      },
      required: ["yourBusiness", "competitors"],
    },
    actionableInsight: {
      type: "object",
      properties: {
        executiveSummary: { type: "string" },
        priorities: { type: "array", items: { type: "string" } },
        opportunities: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        recommendedActions: { type: "array", items: { type: "string" } },
        competitivePosition: { type: "string" },
        nextSteps: { type: "array", items: { type: "string" } },
      },
      required: ["executiveSummary", "priorities", "opportunities", "risks", "recommendedActions", "competitivePosition", "nextSteps"],
    },
  },
  required: ["requestContext", "competitors", "localEvents", "weather", "sentiment", "actionableInsight"],
} as const;
