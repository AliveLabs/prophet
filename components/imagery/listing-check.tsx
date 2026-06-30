// Listing Check (ALT-160) — a storefront audit of the photos on the operator's
// own Google listing. Coverage punch-list + quality read + owner-vs-customer
// asymmetry + a short "fix next" to-do. Reusable: drop it anywhere with the
// location's own-listing photo rows. Server component — pure render from data.

import { buildListingAudit, type PhotoRow } from "@/lib/places/listing-audit"
import { TkCard, TkSectionHead, RevealOnView } from "@/components/ticket"
import "./imagery.css"

const STATE_LABEL = { covered: "Covered", thin: "Thin", missing: "Missing" } as const

export default function ListingCheck({
  photos,
  hasPlaceId = true,
}: {
  photos: PhotoRow[]
  /** When there are no photos yet but the listing IS connected, we show a brief
   *  first-run note instead of hiding — the read lands after the next scan. */
  hasPlaceId?: boolean
}) {
  const count = photos?.length ?? 0

  if (count === 0) {
    if (!hasPlaceId) return null
    return (
      <section className="img-mod">
        <TkSectionHead
          title="Your Google listing"
          sub="The photos people see when they look you up"
        />
        <RevealOnView>
          <TkCard className="img-firstrun">
            <p>
              We&apos;re reading the photos on your Google listing. Your storefront check —
              what&apos;s covered, how it reads, and who&apos;s shaping it — lands after the next scan.
            </p>
          </TkCard>
        </RevealOnView>
      </section>
    )
  }

  const a = buildListingAudit(photos)

  // Only surface the owner-vs-customer split when it's trustworthy: enough volume
  // AND a genuine MIX. If every photo reads as customer-attributed (ownerCount 0),
  // that's far more likely the attribution heuristic failing than the owner having
  // shaped nothing — so we fall back to a neutral count rather than overclaim.
  const showSplit = a.showSplit && a.customerCount > 0 && a.ownerCount > 0

  return (
    <section className="img-mod">
      <TkSectionHead
        title="Your Google listing"
        sub="The photos people see when they look you up — what's covered, how it reads, and who's shaping it"
      />

      <RevealOnView>
        {/* Lead line — the owner-vs-customer asymmetry (gated by showSplit). */}
        {showSplit ? (
          <p className="img-lead">
            Customers uploaded <strong>{a.customerCount}</strong> of the {a.total} photos on your
            listing — you&apos;ve shaped <strong>{a.ownerCount}</strong>.
          </p>
        ) : (
          <p className="img-lead">
            <strong>{a.total}</strong> photo{a.total === 1 ? "" : "s"} on your listing.
          </p>
        )}

        {/* Header stats */}
        <div className="img-stats">
          <div className="img-stat">
            <span className="img-stat-v">{a.coveredCount}<span className="img-stat-d">/{a.essentialTotal}</span></span>
            <span className="img-stat-k">Essentials covered</span>
          </div>
          <div className="img-stat">
            <span className="img-stat-v">{a.professionalShare}%</span>
            <span className="img-stat-k">Pro-shot share</span>
          </div>
          {showSplit && (
            <div className="img-stat">
              <span className="img-stat-v">{a.ownerCount}<span className="img-stat-d">/{a.total}</span></span>
              <span className="img-stat-k">You&apos;ve shaped</span>
            </div>
          )}
        </div>

        <div className="img-grid2">
          {/* Coverage checklist */}
          <TkCard className="img-coverage">
            <div className="img-card-head"><span>Coverage</span></div>
            <ul className="img-cov-list">
              {a.essentials.map((e) => (
                <li key={e.slot} className={`img-cov img-cov-${e.state}`}>
                  <span className={`img-cov-chip img-cov-chip-${e.state}`}>{STATE_LABEL[e.state]}</span>
                  <span className="img-cov-label">{e.label}</span>
                  <span className="img-cov-why">{e.why}</span>
                </li>
              ))}
            </ul>
          </TkCard>

          {/* Fix next */}
          {a.fixNext.length > 0 ? (
            <TkCard className="img-fix">
              <div className="img-card-head"><span>Fix next</span></div>
              <ol className="img-fix-list">
                {a.fixNext.map((f, i) => (
                  <li key={i} className="img-fix-item">
                    <span className="img-fix-n" aria-hidden="true">{i + 1}</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ol>
            </TkCard>
          ) : (
            <TkCard className="img-fix img-fix-clear">
              <div className="img-card-head"><span>Fix next</span></div>
              <p className="img-fix-none">
                Your essentials are covered. Keep the set fresh and on-brand.
              </p>
            </TkCard>
          )}
        </div>
      </RevealOnView>
    </section>
  )
}
