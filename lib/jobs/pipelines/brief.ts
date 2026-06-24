// ---------------------------------------------------------------------------
// Brief Pipeline — builds the synthesized daily brief for ONE location
// (dossier -> runBrief -> saveBrief), then sends the one-time first-brief
// email. Enqueued by the worker when a first_run insights job completes, so a
// new signup's first brief lands during onboarding (or arrives by email after
// they close the tab) instead of waiting for the next 8:00 UTC build-brief
// cron. The scheduled daily rebuild stays on /api/cron/build-brief.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { buildDossier } from "@/lib/insights/dossier/build"
import { runBrief } from "@/lib/skills/pipeline"
import { saveBrief, hasAnyBrief } from "@/lib/insights/daily-brief"
import { loadActiveCooldowns, loadEvergreenPlays } from "@/lib/insights/evergreen"
import { loadPlayTypeMultipliersForLocation, loadShadowPlayTypeMultipliers } from "@/lib/skills/feedback-rollup"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { runStandingQuestion } from "@/lib/ask/history"
import { sendEmail, FROM_ADDRESS_TICKET, FROM_ADDRESS_NEAT } from "@/lib/email/send"
import { FirstBriefReady } from "@/lib/email/templates/first-brief-ready"
import { isValidIndustryType } from "@/lib/verticals"

export type BriefPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  state: {
    isFirstBrief: boolean
    headline: string | null
  }
}

export async function buildBriefContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<BriefPipelineCtx> {
  return {
    supabase,
    locationId,
    organizationId,
    state: { isFirstBrief: false, headline: null },
  }
}

export function buildBriefSteps(): PipelineStepDef<BriefPipelineCtx>[] {
  return [
    {
      name: "build_and_save_brief",
      label: "Synthesizing the brief",
      run: async (c) => {
        // First-brief check must happen BEFORE the save.
        c.state.isFirstBrief = !(await hasAnyBrief(c.locationId))

        const dossier = await buildDossier(c.locationId)
        // P7a/P7b: suppress dismissed plays (cooldown) + resurface relevant saved plays. Both fail-soft.
        // P15: load the distilled click-feedback multiplier lookup (fail-soft → neutral pre-migration).
        // P17a: load the SHADOW multiplier set (shadow feedback_pattern learnings). It NEVER serves —
        // it only drives the shadow replay + log in synthesis. Fail-soft → EMPTY (no replay).
        const skillIds = PRODUCER_SKILLS.map((s) => s.id)
        const [suppressedKeys, evergreen, playTypeMultipliers, shadow] = await Promise.all([
          loadActiveCooldowns(c.locationId),
          loadEvergreenPlays(c.locationId),
          loadPlayTypeMultipliersForLocation(c.locationId, skillIds),
          loadShadowPlayTypeMultipliers(skillIds, { locationId: c.locationId }),
        ])
        const { brief, dropped } = await runBrief(dossier, {
          suppressedKeys,
          evergreen,
          playTypeMultipliers,
          shadowMultipliers: shadow.lookup,
          shadowSignalCount: shadow.signalCount,
        })
        await saveBrief(brief)
        c.state.headline = brief.headline ?? null

        // Pinned standing question re-runs on the fresh signals (mirrors the
        // build-brief cron). Non-fatal: the brief itself is already saved.
        let standing: unknown = null
        try {
          standing = await runStandingQuestion(c.locationId)
        } catch {
          standing = "failed"
        }

        return {
          isFirstBrief: c.state.isFirstBrief,
          headline: c.state.headline,
          plays: brief.plays.length,
          dropped: dropped.length,
          standing,
        }
      },
    },
    {
      name: "notify_first_brief",
      label: "Sending the first-brief email",
      run: async (c) => {
        if (!c.state.isFirstBrief) return { sent: 0, reason: "not the first brief" }

        const { data: org } = await c.supabase
          .from("organizations")
          .select("industry_type")
          .eq("id", c.organizationId)
          .maybeSingle()
        const { data: loc } = await c.supabase
          .from("locations")
          .select("name")
          .eq("id", c.locationId)
          .maybeSingle()

        const industry = isValidIndustryType(org?.industry_type)
          ? org.industry_type
          : "restaurant"
        const brand = industry === "liquor_store" ? ("Neat" as const) : ("Ticket" as const)
        const fromAddress = industry === "liquor_store" ? FROM_ADDRESS_NEAT : FROM_ADDRESS_TICKET
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

        const { data: owners } = await c.supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", c.organizationId)
          .in("role", ["owner", "admin"])

        let sent = 0
        for (const owner of owners ?? []) {
          const { data: profile } = await c.supabase
            .from("profiles")
            .select("email, full_name")
            .eq("id", owner.user_id)
            .maybeSingle()
          if (!profile?.email) continue

          const userName = profile.full_name ?? profile.email.split("@")[0]
          try {
            // Bypasses the CLIENT_EMAILS_ENABLED pause: the onboarding loading
            // screen explicitly promises this email ("close this tab — we'll
            // email you"), so suppressing it breaks a commitment, like the
            // trial reminders.
            await sendEmail({
              from: fromAddress,
              to: profile.email,
              subject: `${userName}, your first ${brand} brief is ready`,
              react: FirstBriefReady({
                brand,
                userName,
                locationName: loc?.name ?? "your location",
                headline: c.state.headline,
                briefUrl: `${appUrl}/home`,
              }),
              clientFacing: true,
              overrideClientEmailPause: true,
            })
            sent++
          } catch {
            // Non-fatal: the brief is saved; the in-app new-brief notice still fires.
          }
        }
        return { sent }
      },
    },
  ]
}
