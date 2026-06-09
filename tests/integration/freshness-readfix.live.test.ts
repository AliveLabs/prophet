import { describe, it, expect } from "vitest"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { socialContentAsOf } from "@/lib/freshness/extract"
import { classifyNow, isUsable } from "@/lib/freshness/contract"

// Live read-only check against the Supabase branch: prove the dossier read-fix
// excludes dormant social accounts by REAL content date. Run with env sourced:
//   set -a; . ./.env.local; set +a; npx vitest run --config vitest.integration.config.ts tests/integration/freshness-readfix.live.test.ts
describe("read-fix (live): dormant social is excluded by content date", () => {
  it("classifies latest social snapshot per profile on real branch data", async () => {
    const sb = createAdminSupabaseClient()
    const { data: profiles } = await sb.from("social_profiles").select("id, entity_id, platform, handle")
    const profById = new Map((profiles ?? []).map((p) => [p.id as string, p]))
    const { data: snaps } = await sb
      .from("social_snapshots")
      .select("social_profile_id, raw_data, captured_at, date_key")
      .order("date_key", { ascending: false })

    const seen = new Set<string>()
    const rows: Array<{ handle: string; platform: string; contentAsOf: string; status: string; usable: boolean }> = []
    for (const s of snaps ?? []) {
      const pid = s.social_profile_id as string
      if (seen.has(pid)) continue // first = latest (date desc)
      seen.add(pid)
      const prof = profById.get(pid)
      if (!prof) continue
      const probe = socialContentAsOf(s.raw_data as Record<string, unknown>)
      const status = classifyNow({
        contentAsOf: probe.contentAsOf,
        capturedAt: (s.captured_at as string) ?? (s.date_key as string),
        isEmpty: probe.isEmpty,
        kind: "social",
        now: new Date().toISOString(),
      })
      rows.push({
        handle: prof.handle as string,
        platform: prof.platform as string,
        contentAsOf: probe.contentAsOf?.slice(0, 10) ?? "none",
        status,
        usable: isUsable(status),
      })
    }

    const usable = rows.filter((r) => r.usable)
    const excluded = rows.filter((r) => !r.usable)
    console.log(`\n[read-fix] ${rows.length} profiles · ${usable.length} USABLE · ${excluded.length} EXCLUDED`)
    console.log(`USABLE   : ${usable.map((r) => `${r.handle}(${r.contentAsOf})`).join(", ") || "(none)"}`)
    console.log(`EXCLUDED : ${excluded.map((r) => `${r.handle}[${r.status} ${r.contentAsOf}]`).join(", ") || "(none)"}`)

    // Known-dormant handles from the audit must be excluded (never shown as current).
    const byHandle = new Map(rows.map((r) => [r.handle, r]))
    for (const dead of ["gyukakuatlanta", "terillisrestaurant", "bushscknforney"]) {
      const r = byHandle.get(dead)
      if (r) expect(r.usable, `${dead} (last post ${r.contentAsOf}) must be excluded`).toBe(false)
    }
    expect(rows.length).toBeGreaterThan(0)
  })
})
