"use server"

import { updateTag } from "next/cache"
import {
  saveSocialProfileAction as _save,
  deleteSocialProfileAction as _delete,
  verifySocialProfileAction as _verify,
  runSocialDiscoveryAction as _discover,
  fetchSocialDashboardData as _fetchDashboard,
  generateSocialInsightsForLocation as _generate,
} from "@/app/(dashboard)/insights/social-actions"

export async function saveSocialProfileAction(data: {
  entityType: "location" | "competitor"
  entityId: string
  platform: string
  handle: string
}): Promise<{ error?: string }> {
  return _save(data)
}

export async function deleteSocialProfileAction(id: string): Promise<{ error?: string }> {
  return _delete(id)
}

export async function verifySocialProfileAction(id: string): Promise<{ error?: string }> {
  return _verify(id)
}

export async function runSocialDiscoveryAction(locationId: string): Promise<{ discovered: number; error?: string }> {
  return _discover(locationId)
}

export async function fetchSocialDashboardData(locationId: string) {
  return _fetchDashboard(locationId)
}

export async function generateSocialInsightsForLocation(locationId: string, dateKey: string) {
  return _generate(locationId, dateKey)
}

export async function revalidateSocialCache() {
  updateTag("social-data")
  updateTag("home-data")
}
