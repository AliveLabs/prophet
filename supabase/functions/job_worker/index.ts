import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

type JobMessage = {
  job_type: "fetch_snapshot" | "generate_insights"
  organization_id: string
  location_id: string
  competitor_id: string
  date_key: string
  attempt: number
  trace_id: string
}

type NormalizedSnapshot = {
  version: "1.0"
  timestamp: string
  profile?: {
    title?: string
    rating?: number
    reviewCount?: number
    priceLevel?: string
    address?: string
    website?: string
    phone?: string
  }
  hours?: Record<string, string>
  source_raw?: unknown
}

function normalizeSnapshot(raw: Record<string, unknown>): NormalizedSnapshot {
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    profile: {
      title: raw.title as string | undefined,
      rating: raw.rating as number | undefined,
      reviewCount: raw.reviews_count as number | undefined,
      priceLevel: raw.price_level as string | undefined,
      address: raw.address as string | undefined,
      website: raw.site as string | undefined,
      phone: raw.phone as string | undefined,
    },
    hours: (raw.work_hours as Record<string, string> | undefined) ?? undefined,
    source_raw: raw,
  }
}

function computeDiffHash(snapshot: NormalizedSnapshot) {
  const payload = {
    rating: snapshot.profile?.rating ?? null,
    reviewCount: snapshot.profile?.reviewCount ?? null,
    priceLevel: snapshot.profile?.priceLevel ?? null,
    address: snapshot.profile?.address ?? null,
    website: snapshot.profile?.website ?? null,
    phone: snapshot.profile?.phone ?? null,
    hours: snapshot.hours ?? {},
  }
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(payload))
  return crypto.subtle.digest("SHA-256", data).then((hash) => {
    const bytes = Array.from(new Uint8Array(hash))
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("")
  })
}

function diffSnapshots(previous: NormalizedSnapshot | null, current: NormalizedSnapshot) {
  const prev = previous?.profile ?? {}
  const next = current.profile ?? {}
  const ratingDelta =
    typeof next.rating === "number" && typeof prev.rating === "number"
      ? Number((next.rating - prev.rating).toFixed(2))
      : null
  const reviewCountDelta =
    typeof next.reviewCount === "number" && typeof prev.reviewCount === "number"
      ? next.reviewCount - prev.reviewCount
      : null
  const hoursChanged = JSON.stringify(previous?.hours ?? {}) !== JSON.stringify(current.hours ?? {})

  return { ratingDelta, reviewCountDelta, hoursChanged }
}

async function fetchDataForSEO(placeId: string) {
  const login = Deno.env.get("DATAFORSEO_LOGIN")
  const password = Deno.env.get("DATAFORSEO_PASSWORD")
  if (!login || !password) {
    throw new Error("DATAFORSEO credentials not configured")
  }

  const auth = btoa(`${login}:${password}`)
  const response = await fetch(
    "https://api.dataforseo.com/v3/business_data/google/my_business_info/live",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          place_id: placeId,
          language_name: "English",
        },
      ]),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`DataForSEO request failed: ${response.status} ${text}`)
  }

  const data = await response.json()
  return data?.tasks?.[0]?.result?.[0]?.items?.[0] ?? null
}

function getPreviousDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

serve(async (req) => {
  try {
    const job = (await req.json()) as JobMessage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceKey) {
      return new Response("Missing Supabase credentials", { status: 500 })
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    if (job.job_type === "fetch_snapshot") {
      const { data: competitor, error } = await supabase
        .from("competitors")
        .select("provider, provider_entity_id")
        .eq("id", job.competitor_id)
        .single()

      if (error || !competitor) {
        return new Response("Competitor not found", { status: 404 })
      }

      const raw = await fetchDataForSEO(competitor.provider_entity_id)
      const normalized = normalizeSnapshot(raw ?? {})
      const diffHash = await computeDiffHash(normalized)

      const { error: snapshotError } = await supabase.from("snapshots").upsert(
        {
          competitor_id: job.competitor_id,
          captured_at: new Date().toISOString(),
          date_key: job.date_key,
          provider: competitor.provider,
          raw_data: normalized,
          diff_hash: diffHash,
        },
        {
          onConflict: "competitor_id,date_key",
        }
      )

      if (snapshotError) {
        throw snapshotError
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    if (job.job_type === "generate_insights") {
      const { data: currentSnapshot } = await supabase
        .from("snapshots")
        .select("raw_data, date_key")
        .eq("competitor_id", job.competitor_id)
        .eq("date_key", job.date_key)
        .single()

      if (!currentSnapshot) {
        return new Response("Snapshot not found", { status: 404 })
      }

      const previousKey = getPreviousDateKey(job.date_key, 1)
      const weeklyKey = getPreviousDateKey(job.date_key, 7)
      const { data: previousSnapshot } = await supabase
        .from("snapshots")
        .select("raw_data")
        .eq("competitor_id", job.competitor_id)
        .eq("date_key", previousKey)
        .maybeSingle()

      const { data: weeklySnapshot } = await supabase
        .from("snapshots")
        .select("raw_data")
        .eq("competitor_id", job.competitor_id)
        .eq("date_key", weeklyKey)
        .maybeSingle()

      const diff = diffSnapshots(
        previousSnapshot?.raw_data as NormalizedSnapshot | null,
        currentSnapshot.raw_data as NormalizedSnapshot
      )

      const weeklyDiff = diffSnapshots(
        weeklySnapshot?.raw_data as NormalizedSnapshot | null,
        currentSnapshot.raw_data as NormalizedSnapshot
      )

      const insights: Array<Record<string, unknown>> = []
      if (diff.ratingDelta !== null && Math.abs(diff.ratingDelta) >= 0.1) {
        insights.push({
          insight_type: "rating_change",
          title: diff.ratingDelta >= 0 ? "Rating increased" : "Rating decreased",
          summary: `Rating changed by ${diff.ratingDelta}.`,
          confidence: "high",
          severity: diff.ratingDelta < 0 ? "warning" : "info",
          evidence: { field: "rating", delta: diff.ratingDelta },
          recommendations: [],
        })
      }
      if (diff.reviewCountDelta !== null && Math.abs(diff.reviewCountDelta) >= 2) {
        insights.push({
          insight_type: "review_velocity",
          title: "Review velocity changed",
          summary: `Review count changed by ${diff.reviewCountDelta}.`,
          confidence: "high",
          severity: "info",
          evidence: { field: "reviewCount", delta: diff.reviewCountDelta },
          recommendations: [],
        })
      }
      if (diff.hoursChanged) {
        insights.push({
          insight_type: "hours_changed",
          title: "Hours updated",
          summary: "Business hours changed since the last snapshot.",
          confidence: "medium",
          severity: "info",
          evidence: { field: "hours" },
          recommendations: [],
        })
      }

      if (weeklySnapshot) {
        if (weeklyDiff.ratingDelta !== null && Math.abs(weeklyDiff.ratingDelta) >= 0.2) {
          insights.push({
            insight_type: "weekly_rating_trend",
            title: "Weekly rating trend",
            summary: `Rating changed by ${weeklyDiff.ratingDelta} over the last week.`,
            confidence: "medium",
            severity: weeklyDiff.ratingDelta < 0 ? "warning" : "info",
            evidence: { field: "rating", delta: weeklyDiff.ratingDelta, window: "t-7" },
            recommendations: [],
          })
        }
        if (
          weeklyDiff.reviewCountDelta !== null &&
          Math.abs(weeklyDiff.reviewCountDelta) >= 5
        ) {
          insights.push({
            insight_type: "weekly_review_trend",
            title: "Weekly review trend",
            summary: `Review count changed by ${weeklyDiff.reviewCountDelta} over the last week.`,
            confidence: "medium",
            severity: "info",
            evidence: {
              field: "reviewCount",
              delta: weeklyDiff.reviewCountDelta,
              window: "t-7",
            },
            recommendations: [],
          })
        }
      }

      if (insights.length) {
        const payload = insights.map((insight) => ({
          location_id: job.location_id,
          competitor_id: job.competitor_id,
          date_key: job.date_key,
          ...insight,
          status: "new",
        }))

        const { error: insightsError } = await supabase.from("insights").upsert(payload, {
          onConflict: "location_id,competitor_id,date_key,insight_type",
        })

        if (insightsError) {
          throw insightsError
        }
      }

      return new Response(JSON.stringify({ ok: true, insights: insights.length }), {
        status: 200,
      })
    }

    return new Response("Unsupported job type", { status: 400 })
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
    })
  }
})
