import { connection } from "next/server"
import Link from "next/link"
import type { CSSProperties } from "react"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { RevealOnView, TkEmptyState } from "@/components/ticket"
import "@/components/ticket/pass.css"
import "./sandbox.css"

// Admin-owned, non-billable demo + test orgs. PRESENTATION rebuilt to "The Pass":
// re-authored from a bordered <table> into a Pass card grid (mobile-native, no
// horizontal scroll). Self-hosts its own `.ticket-chrome` surface + kit CSS + atmos
// canvas because the admin shell isn't a Pass surface. Data query is unchanged.
export default async function SandboxPage() {
  await connection()
  const supabase = createAdminSupabaseClient()

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, slug, org_kind, industry_type, subscription_tier, created_at")
    .in("org_kind", ["demo", "test"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  const rows = orgs ?? []
  const demoCount = rows.filter((o) => o.org_kind === "demo").length
  const testCount = rows.filter((o) => o.org_kind === "test").length

  return (
    <div className="ticket-chrome tk-kit">
      <div className="bg-atmos" aria-hidden />
      <div className="sb-surface">
        <RevealOnView as="header" className="sb-head">
          <div className="sb-head-text">
            <span className="sb-eyebrow">
              {flaskIcon}
              Non-billable orgs
            </span>
            <h1>Demo &amp; Test</h1>
            <p className="sb-lede">
              Admin-owned orgs that never appear in real metrics — and the only orgs
              Maintenance may bulk-clear. Use them to walk a customer through Ticket
              or to exercise the pipeline safely.
            </p>
          </div>
          <Link href="/admin/organizations/new" className="sb-new">
            {plusIcon}
            New demo / test org
          </Link>
        </RevealOnView>

        <RevealOnView className="sb-stats" stagger>
          <div className="sb-stat">
            <div className="sb-k">Total</div>
            <div className="sb-v">{rows.length}</div>
          </div>
          <div className="sb-stat">
            <div className="sb-k"><span className="sb-swatch sb-swatch-demo" aria-hidden />Demo</div>
            <div className="sb-v">{demoCount}</div>
          </div>
          <div className="sb-stat">
            <div className="sb-k"><span className="sb-swatch sb-swatch-test" aria-hidden />Test</div>
            <div className="sb-v">{testCount}</div>
          </div>
        </RevealOnView>

        <div className="mt-7">
          {rows.length === 0 ? (
            <TkEmptyState
              icon={flaskIcon}
              title="No demo or test orgs yet"
              description="Spin one up to demo Ticket to a customer or to exercise the pipeline without touching real data."
              action={
                <Link href="/admin/organizations/new" className="sb-new">
                  {plusIcon}
                  New demo / test org
                </Link>
              }
            />
          ) : (
            <RevealOnView className="sb-grid" stagger>
              {rows.map((o, i) => (
                <article
                  key={o.id}
                  className="sb-org"
                  style={{ ["--tk-i"]: i } as CSSProperties}
                >
                  <div className="sb-org-top">
                    <div>
                      <div className="sb-org-name">{o.name}</div>
                      {o.slug && <div className="sb-org-slug">/{o.slug}</div>}
                    </div>
                    <span className={`sb-kind sb-kind-${o.org_kind}`}>
                      <span className="sb-dot" aria-hidden />
                      {o.org_kind}
                    </span>
                  </div>

                  <div className="sb-attrs">
                    <div className="sb-attr">
                      <span className="sb-ak">{tagIcon}Industry</span>
                      <span className="sb-av">
                        {o.industry_type === "liquor_store" ? "Liquor store" : "Restaurant"}
                      </span>
                    </div>
                    <div className="sb-attr">
                      <span className="sb-ak">{tierIcon}Tier</span>
                      <span className="sb-av sb-mono">{o.subscription_tier}</span>
                    </div>
                    <div className="sb-attr">
                      <span className="sb-ak">{calIcon}Created</span>
                      <span className="sb-av">{new Date(o.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <Link href={`/admin/organizations/${o.id}`} className="sb-view" aria-label={`View ${o.name}`}>
                    View org
                    {arrowIcon}
                  </Link>
                </article>
              ))}
            </RevealOnView>
          )}
        </div>
      </div>
    </div>
  )
}

const flaskIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3h6M10 3v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3" />
    <path d="M7.5 14h9" />
  </svg>
)
const plusIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const tagIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12V4h8l10 10-8 8L3 12z" />
    <circle cx="7.5" cy="7.5" r="1.2" />
  </svg>
)
const tierIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19h16M6 19V9l6-4 6 4v10M10 19v-5h4v5" />
  </svg>
)
const calIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </svg>
)
const arrowIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
