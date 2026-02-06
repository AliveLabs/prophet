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

    // =====================================================================
    // EVENTS JOBS
    // =====================================================================

    if (job.job_type === "fetch_events_snapshot") {
      // Fetch location details
      const { data: location, error: locErr } = await supabase
        .from("locations")
        .select("id, city, region, country, organization_id")
        .eq("id", job.location_id)
        .single()

      if (locErr || !location) {
        return new Response("Location not found", { status: 404 })
      }

      // Determine tier
      const { data: org } = await supabase
        .from("organizations")
        .select("subscription_tier")
        .eq("id", location.organization_id)
        .single()

      const tier = org?.subscription_tier ?? "free"
      const locationName = [location.city, location.region, location.country ?? "United States"]
        .filter(Boolean)
        .join(",")
      const maxQueries = tier === "free" ? 1 : 2
      const depth = 10

      const queryDefs: Array<{ keyword: string; date_range: string }> = []
      if (maxQueries >= 2) {
        queryDefs.push(
          { keyword: "events", date_range: "week" },
          { keyword: "events", date_range: "weekend" }
        )
      } else {
        queryDefs.push({ keyword: "events", date_range: "weekend" })
      }

      // Call DataForSEO for each query
      const login = Deno.env.get("DATAFORSEO_LOGIN")
      const password = Deno.env.get("DATAFORSEO_PASSWORD")
      if (!login || !password) {
        throw new Error("DATAFORSEO credentials not configured")
      }
      const auth = btoa(`${login}:${password}`)

      const allItems: Array<Record<string, unknown>> = []
      for (const q of queryDefs) {
        const response = await fetch(
          "https://api.dataforseo.com/v3/serp/google/events/live/advanced",
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([
              {
                keyword: q.keyword,
                location_name: locationName,
                language_code: "en",
                device: "desktop",
                os: "windows",
                depth,
                date_range: q.date_range,
              },
            ]),
          }
        )

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`DataForSEO events error: ${response.status} ${text}`)
        }

        const data = await response.json()
        const items = data?.tasks?.[0]?.result?.[0]?.items ?? []
        for (const item of items) {
          allItems.push({ ...item, _query_keyword: q.keyword, _query_date_range: q.date_range })
        }
      }

      // Store raw snapshot (normalization happens in match/insight jobs)
      const rawPayload = {
        version: "1.0",
        capturedAt: new Date().toISOString(),
        locationName,
        queries: queryDefs,
        items: allItems,
        totalEvents: allItems.length,
      }

      // Compute a simple diff hash
      const encoder = new TextEncoder()
      const hashData = encoder.encode(JSON.stringify(allItems.map((i) => ({
        title: i.title, url: i.url, start: (i.event_dates as Record<string, unknown>)?.start_datetime,
      }))))
      const hashBuf = await crypto.subtle.digest("SHA-256", hashData)
      const diffHash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")

      const { error: snapError } = await supabase.from("location_snapshots").upsert(
        {
          location_id: job.location_id,
          provider: "dataforseo_google_events",
          date_key: job.date_key,
          captured_at: new Date().toISOString(),
          raw_data: rawPayload,
          diff_hash: diffHash,
        },
        { onConflict: "location_id,provider,date_key" }
      )

      if (snapError) throw snapError

      return new Response(
        JSON.stringify({ ok: true, events: allItems.length }),
        { status: 200 }
      )
    }

    if (job.job_type === "match_events_to_competitors") {
      // Load latest snapshot
      const { data: snap } = await supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", job.location_id)
        .eq("provider", "dataforseo_google_events")
        .eq("date_key", job.date_key)
        .maybeSingle()

      if (!snap) {
        return new Response("No events snapshot found", { status: 404 })
      }

      // Load approved competitors
      const { data: competitors } = await supabase
        .from("competitors")
        .select("id, name, address, website, metadata, is_active")
        .eq("location_id", job.location_id)
        .eq("is_active", true)

      const approved = (competitors ?? []).filter((c) => {
        const meta = c.metadata as Record<string, unknown> | null
        return meta?.status === "approved"
      })

      if (approved.length === 0) {
        return new Response(JSON.stringify({ ok: true, matches: 0 }), { status: 200 })
      }

      // Simple venue-name matching (deterministic)
      const rawData = snap.raw_data as Record<string, unknown>
      const items = (rawData.items ?? []) as Array<Record<string, unknown>>

      const matchRecords: Array<Record<string, unknown>> = []

      for (const item of items) {
        const locationInfo = item.location_info as Record<string, unknown> | undefined
        const venueName = (locationInfo?.name as string ?? "").toLowerCase().trim()

        for (const comp of approved) {
          const compName = (comp.name ?? "").toLowerCase().trim()

          if (venueName && compName && venueName === compName) {
            matchRecords.push({
              location_id: job.location_id,
              competitor_id: comp.id,
              date_key: job.date_key,
              event_uid: String(item.title ?? "").slice(0, 64),
              match_type: "venue_name",
              confidence: "high",
              evidence: {
                event_title: item.title,
                venue_name: venueName,
                competitor_name: compName,
              },
            })
          }
        }
      }

      if (matchRecords.length > 0) {
        await supabase
          .from("event_matches")
          .delete()
          .eq("location_id", job.location_id)
          .eq("date_key", job.date_key)

        const { error: matchErr } = await supabase
          .from("event_matches")
          .insert(matchRecords)

        if (matchErr) throw matchErr
      }

      return new Response(
        JSON.stringify({ ok: true, matches: matchRecords.length }),
        { status: 200 }
      )
    }

    if (job.job_type === "generate_event_insights") {
      // Load current snapshot
      const { data: currentSnap } = await supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", job.location_id)
        .eq("provider", "dataforseo_google_events")
        .eq("date_key", job.date_key)
        .maybeSingle()

      if (!currentSnap) {
        return new Response("No events snapshot found", { status: 404 })
      }

      const rawData = currentSnap.raw_data as Record<string, unknown>
      const currentCount = (rawData.totalEvents as number) ?? 0

      // Load previous snapshot
      const prevKey = getPreviousDateKey(job.date_key, 1)
      const { data: prevSnap } = await supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", job.location_id)
        .eq("provider", "dataforseo_google_events")
        .eq("date_key", prevKey)
        .maybeSingle()

      const prevCount = prevSnap
        ? ((prevSnap.raw_data as Record<string, unknown>).totalEvents as number) ?? 0
        : 0

      const insights: Array<Record<string, unknown>> = []

      // Density spike (simple: total event count change)
      if (prevSnap && prevCount > 0) {
        const delta = currentCount - prevCount
        const pctChange = delta / prevCount
        if (pctChange >= 0.3 && delta >= 5) {
          insights.push({
            insight_type: "events.weekend_density_spike",
            title: "Event activity is surging nearby",
            summary: `Events increased from ${prevCount} to ${currentCount} (+${Math.round(pctChange * 100)}%).`,
            confidence: "medium",
            severity: "info",
            evidence: { current: currentCount, previous: prevCount, delta },
            recommendations: [
              { title: "Prepare for increased demand", rationale: "More events nearby may drive foot traffic." },
            ],
          })
        }
      }

      // Competitor hosting (from matches)
      const { data: matches } = await supabase
        .from("event_matches")
        .select("*")
        .eq("location_id", job.location_id)
        .eq("date_key", job.date_key)

      if (matches && matches.length > 0) {
        const byComp = new Map<string, Array<Record<string, unknown>>>()
        for (const m of matches) {
          if (!m.competitor_id) continue
          const arr = byComp.get(m.competitor_id) ?? []
          arr.push(m)
          byComp.set(m.competitor_id, arr)
        }

        for (const [compId, compMatches] of byComp) {
          insights.push({
            insight_type: "events.competitor_hosting_event",
            title: "A competitor appears linked to nearby events",
            summary: `Competitor is associated with ${compMatches.length} event(s).`,
            confidence: "medium",
            severity: "info",
            evidence: {
              competitor_id: compId,
              matched_events: compMatches.length,
            },
            recommendations: [],
          })
        }
      }

      if (insights.length > 0) {
        const payload = insights.map((ins) => ({
          location_id: job.location_id,
          competitor_id: ins.competitor_id ? String(ins.competitor_id) : null,
          date_key: job.date_key,
          ...ins,
          status: "new",
        }))

        const { error: insErr } = await supabase
          .from("insights")
          .upsert(payload, { onConflict: "location_id,competitor_id,date_key,insight_type" })

        if (insErr) throw insErr
      }

      return new Response(
        JSON.stringify({ ok: true, insights: insights.length }),
        { status: 200 }
      )
    }

    return new Response("Unsupported job type", { status: 400 })
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
    })
  }
})
