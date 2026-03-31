export const TRIAL_DURATION_DAYS = 14

interface TrialOrg {
  trial_ends_at: string | null
  subscription_tier: string
}

export function isTrialActive(org: TrialOrg): boolean {
  if (org.subscription_tier === "suspended") return false
  if (org.subscription_tier !== "free") return true
  if (!org.trial_ends_at) return false
  return new Date(org.trial_ends_at) > new Date()
}

export function getTrialDaysRemaining(org: {
  trial_ends_at: string | null
}): number {
  if (!org.trial_ends_at) return 0
  const diff = new Date(org.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function isTrialExpiringSoon(
  org: { trial_ends_at: string | null },
  thresholdDays: number = 3
): boolean {
  const remaining = getTrialDaysRemaining(org)
  return remaining > 0 && remaining <= thresholdDays
}
