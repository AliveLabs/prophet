// Listing Check (ALT-160) — a storefront audit of the photos on the operator's
// own Google listing. Coverage punch-list + quality read + owner-vs-customer
// asymmetry + a short "fix next" to-do. Reusable: drop it anywhere with the
// location's own-listing photo rows. Server component — pure render from data.

import { buildListingAudit, type PhotoRow, type GalleryPhoto } from "@/lib/places/listing-audit"
import { TkCard, TkSectionHead, RevealOnView } from "@/components/ticket"
import "./imagery.css"

const STATE_LABEL = { covered: "Covered", thin: "Thin", missing: "Missing" } as const

// A labeled row of listing-photo thumbnails, capped with a "+N" overflow tile.
// Server-rendered (plain img) — segments the gallery into owner vs customer.
function PhotoGroup({ title, photos, tone }: { title: string; photos: GalleryPhoto[]; tone: "own" | "cust" }) {
  const CAP = 8
  const shown = photos.slice(0, CAP)
  const overflow = photos.length - shown.length
  return (
    <div className={`img-gallery-group img-gallery-${tone}`}>
      <div className="img-gallery-head">
        <span>{title}</span>
        <span className="img-gallery-n">{photos.length}</span>
      </div>
      <div className="img-thumbs">
        {shown.map((p, i) => {
          const label = p.category ? p.category.replace(/_/g, " ") : "Listing photo"
          return (
            <div className="img-thumb" key={`${p.url}-${i}`} title={label}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={label} loading="lazy" />
            </div>
          )
        })}
        {overflow > 0 && <div className="img-thumb img-thumb-more">+{overflow}</div>}
      </div>
    </div>
  )
}

export default function ListingCheck({
  photos,
  hasPlaceId = true,
  ownerName,
}: {
  photos: PhotoRow[]
  /** When there are no photos yet but the listing IS connected, we show a brief
   *  first-run note instead of hiding — the read lands after the next scan. */
  hasPlaceId?: boolean
  /** The business/location name — used to tell OWNER-uploaded photos (attributed to
   *  the business's own Google profile) from customer/reviewer uploads. */
  ownerName?: string | null
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

  const a = buildListingAudit(photos, { ownerName })
  // The audit gates the split on volume + a genuine owner/customer mix (so a location
  // where we can't identify the owner falls back to a neutral count).
  const showSplit = a.showSplit

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

        {/* Segmented gallery — your uploads vs what customers posted. Only groups
            with photos render; if the owner can't be identified everything lands
            under "customers" (honest — we don't guess it's yours). */}
        {(a.ownerPhotos.length > 0 || a.customerPhotos.length > 0) && (
          <div className="img-gallery">
            {a.ownerPhotos.length > 0 && (
              <PhotoGroup title="Your photos" photos={a.ownerPhotos} tone="own" />
            )}
            {a.customerPhotos.length > 0 && (
              <PhotoGroup title="What customers posted" photos={a.customerPhotos} tone="cust" />
            )}
          </div>
        )}
      </RevealOnView>
    </section>
  )
}
