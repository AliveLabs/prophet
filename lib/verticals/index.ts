import type { IndustryType, VerticalConfig } from "./types"
import { restaurantConfig } from "./restaurant"
import { liquorStoreConfig } from "./liquor-store"

export type { IndustryType, VerticalConfig, FeatureDefinition } from "./types"

const VERTICALS: Record<IndustryType, VerticalConfig> = {
  restaurant: restaurantConfig,
  liquor_store: liquorStoreConfig,
}

export function getVerticalConfig(industryType?: string | null): VerticalConfig {
  if (
    process.env.VERTICALIZATION_ENABLED !== "true" ||
    !industryType ||
    !(industryType in VERTICALS)
  ) {
    return VERTICALS.restaurant
  }
  return VERTICALS[industryType as IndustryType]
}

export function isValidIndustryType(value: unknown): value is IndustryType {
  return typeof value === "string" && value in VERTICALS
}

export function getAllVerticals(): VerticalConfig[] {
  return Object.values(VERTICALS)
}
