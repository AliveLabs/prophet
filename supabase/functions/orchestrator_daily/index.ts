import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

type OrchestratorRequest = {
  location_id?: string
  date_key?: string
}

function getDateKey(input?: string) {
  if (input) {
    return input
  }
  return new Date().toISOString().slice(0, 10)
}

serve(async (req) => {
  try {
    const payload = (await req.json().catch(() => ({}))) as OrchestratorRequest
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceKey) {
      return new Response("Missing Supabase credentials", { status: 500 })
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    // -----------------------------------------------------------------------
    // Competitor jobs (existing)
    // -----------------------------------------------------------------------
    const compQuery = supabase.from("competitors").select("id, location_id")
    if (payload.location_id) {
      compQuery.eq("location_id", payload.location_id)
    }

    const { data: competitors, error } = await compQuery
    if (error || !competitors) {
      throw error ?? new Error("No competitors found")
    }

    const dateKey = getDateKey(payload.date_key)
    const jobs = competitors.flatMap((competitor) => [
      {
        job_type: "fetch_snapshot",
        location_id: competitor.location_id,
        competitor_id: competitor.id,
        date_key: dateKey,
        attempt: 1,
      },
      {
        job_type: "generate_insights",
        location_id: competitor.location_id,
        competitor_id: competitor.id,
        date_key: dateKey,
        attempt: 1,
      },
    ])

    // -----------------------------------------------------------------------
    // Events jobs (new – location-level)
    // -----------------------------------------------------------------------
    const locQuery = supabase
      .from("locations")
      .select("id, organization_id")
    if (payload.location_id) {
      locQuery.eq("id", payload.location_id)
    }

    const { data: locations, error: locError } = await locQuery
    if (!locError && locations) {
      // Fetch org tiers to determine cadence
      const orgIds = [...new Set(locations.map((l) => l.organization_id))]
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, subscription_tier")
        .in("id", orgIds)

      const orgTierMap = new Map<string, string>()
      for (const org of orgs ?? []) {
        orgTierMap.set(org.id, org.subscription_tier ?? "free")
      }

      const dayOfWeek = new Date().getUTCDay() // 0=Sun, 1=Mon
      for (const location of locations) {
        const tier = orgTierMap.get(location.organization_id) ?? "free"
        const isWeekly = tier === "free"

        // Weekly tiers only run on Monday (day 1)
        if (isWeekly && dayOfWeek !== 1) continue

        jobs.push(
          {
            job_type: "fetch_events_snapshot",
            location_id: location.id,
            competitor_id: "", // not applicable
            date_key: dateKey,
            attempt: 1,
          },
          {
            job_type: "match_events_to_competitors",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          },
          {
            job_type: "generate_event_insights",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          }
        )
      }
    }

    // -----------------------------------------------------------------------
    // SEO Search Intelligence jobs (location-level, weekly or daily)
    // -----------------------------------------------------------------------
    if (locations) {
      for (const location of locations) {
        const tier = orgTierMap.get(location.organization_id) ?? "free"
        const seoLabsCadence = tier === "agency" ? "daily" : "weekly"

        // Weekly SEO runs on Mondays; daily runs every day
        if (seoLabsCadence === "weekly" && dayOfWeek !== 1) continue

        jobs.push(
          {
            job_type: "seo_domain_rank_overview",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          },
          {
            job_type: "seo_ranked_keywords",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          },
          {
            job_type: "seo_competitors_domain",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          },
          {
            job_type: "seo_serp_keywords",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          }
        )

        // Paid-tier-only jobs
        const paidTiers = ["starter", "pro", "agency"]
        if (paidTiers.includes(tier)) {
          jobs.push({
            job_type: "seo_domain_intersection",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          })
        }

        const adsTiers = ["pro", "agency"]
        if (adsTiers.includes(tier)) {
          jobs.push({
            job_type: "seo_ads_search",
            location_id: location.id,
            competitor_id: "",
            date_key: dateKey,
            attempt: 1,
          })
        }

        // Always generate insights after data jobs
        jobs.push({
          job_type: "seo_generate_insights",
          location_id: location.id,
          competitor_id: "",
          date_key: dateKey,
          attempt: 1,
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, jobs }), { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
    })
  }
})
