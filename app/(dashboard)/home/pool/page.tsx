import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { loadPoolEntries } from "@/lib/insights/insight-pool"
import { loadLatestPlayActionsByKey } from "@/lib/insights/momentum"
import { RevealOnView, TkTooltipLayer, TkRule } from "@/components/ticket"
import PoolFeedPass from "./pool-feed-pass"
import "./pool.css"

type LocRow = { id: string; name: string | null }

export default async function InsightPoolPage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/onboarding")

  const { data: locRow } = await (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => { maybeSingle: () => Promise<{ data: LocRow | null }> }
            }
          }
        }
      }
    }
  )
    .from("locations")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!locRow) redirect("/home")

  // loadPoolEntries is fail-soft (returns [] pre-migration / on any error). Reads via the default
  // admin client like getBrief — the page-level auth above already scopes this to the user's own org.
  // ALT-184f/g: the latest per-play actions ride along so pool cards render their Kept/Dismissed
  // state and kept insights pin to the top ("Pinned").
  const [entries, playActions] = await Promise.all([
    loadPoolEntries(locRow.id),
    loadLatestPlayActionsByKey(locRow.id),
  ])

  const topCount = entries.filter((e) => e.is_top).length

  return (
    // .ticket-brief scopes the shared play-card styles (pass-foot, keep/dismiss, thumbs) the
    // pool cards now reuse — the same wrapper the /insights page puts over its kit feed.
    <div className="ticket-brief tk-kit">
      <TkTooltipLayer />
      <div className="pv-page">
      {/* ── PAGE-TITLE CHROME (on-system .pv-* header) ── */}
      <Link href="/home" className="pv-back">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to your brief
      </Link>
      <RevealOnView as="header" className="pv-page-head">
        <div className="pv-kicker">Insight pool</div>
        <h1 className="pv-h1">
          All your insights{locRow.name ? <span className="pool-h1-loc"> · {locRow.name}</span> : null}
        </h1>
        <p className="pv-sub">
          Every insight from your recent briefs accumulates here. The top few surface on your brief
          each morning; the rest stay in the pool, filterable by type
          {entries.length ? (
            <>
              {" "}
              — <b>{entries.length}</b> insight{entries.length === 1 ? "" : "s"} tracked
              {topCount ? (
                <>
                  , <b>{topCount}</b> on this week&apos;s brief
                </>
              ) : null}
              .
            </>
          ) : (
            "."
          )}
        </p>
      </RevealOnView>

      <TkRule />

      {/* ── POOL BODY (kit grid + filters; client island, same data) ── */}
      <div className="pool-body">
        <PoolFeedPass entries={entries} locationId={locRow.id} actions={playActions} />
      </div>
      </div>
    </div>
  )
}
