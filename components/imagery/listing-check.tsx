// Listing Check (ALT-160) — a storefront audit of the photos on the operator's
// own Google listing. Coverage punch-list + quality read + owner-vs-customer
// asymmetry + a short "fix next" to-do. Reusable: drop it anywhere with the
// location's own-listing photo rows. Server component — pure render from data.
//
// ALT-257 reorder: the module used to talk about the photos (stats, coverage,
// fix-next) before ever showing them, so an operator read three blocks of judgement
// about a set they hadn't seen. The order is now: the claim, the photos, then the
// read of them. Also carries the Ask Ticket ingress (see the two <VizTBubble/>s).

import { buildListingAudit, type PhotoRow } from "@/lib/places/listing-audit"
import { TkCard, TkSectionHead, RevealOnView } from "@/components/ticket"
import { VizTBubble } from "@/components/ticket/viz-tbubble"
import { PhotoGallery } from "./photo-lightbox"
import "./imagery.css"

const STATE_LABEL = { covered: "Covered", thin: "Thin", missing: "Missing" } as const

export default function ListingCheck({
  photos,
  hasPlaceId = true,
  ownerName,
  locationId,
}: {
  photos: PhotoRow[]
  /** When there are no photos yet but the listing IS connected, we show a brief
   *  first-run note instead of hiding — the read lands after the next scan. */
  hasPlaceId?: boolean
  /** The business/location name — used to tell OWNER-uploaded photos (attributed to
   *  the business's own Google profile) from customer/reviewer uploads. */
  ownerName?: string | null
  /** ALT-257 — the location the Ask Ticket ingress generates against. Optional: the
   *  generate endpoint validates it and falls back to the caller's own location, so
   *  a surface that doesn't have it (the preview page) still renders. */
  locationId?: string
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
        {/* ── 1. The claim. Lead line (owner-vs-customer asymmetry, gated by showSplit)
               with the module's Ask Ticket ingress beside it, so the affordance sits on
               the sentence it would be answering rather than floating in a corner. ── */}
        <div className="img-leadrow">
          {showSplit ? (
            <p className="img-lead">
              Customers uploaded <strong>{a.customerCount}</strong> of the {a.total} photos on your
              listing. You&apos;ve shaped <strong>{a.ownerCount}</strong>.
            </p>
          ) : (
            <p className="img-lead">
              <strong>{a.total}</strong> photo{a.total === 1 ? "" : "s"} on your listing.
            </p>
          )}
          {/* metric + value are phrased to survive buildAskQuestion's "What does my
              {metric} of {value} mean for my business" template — hence "of 8 customer
              uploads out of 12" rather than a bare "8 of 12", which would come out as
              "of 8 of 12". */}
          <VizTBubble
            className="img-tbub"
            viz={{
              domain: "content",
              metric: showSplit ? "Listing photo mix" : "Listing photo count",
              value: showSplit
                ? `${a.customerCount} customer uploads out of ${a.total}`
                : a.total,
              entityType: "location",
              source: "Business listing data",
              locationId,
            }}
          />
        </div>

        {/* ── 2. The photos themselves — yours vs what customers posted. Only groups
               with photos render; if the owner can't be identified everything lands
               under "customers" (honest — we don't guess it's yours). Moved ABOVE the
               stats and coverage read per ALT-257: judgement after the evidence. ── */}
        {(a.ownerPhotos.length > 0 || a.customerPhotos.length > 0) && (
          <div className="img-gallery">
            {a.ownerPhotos.length > 0 && (
              <PhotoGallery title="Your photos" photos={a.ownerPhotos} tone="own" />
            )}
            {a.customerPhotos.length > 0 && (
              <PhotoGallery title="What customers posted" photos={a.customerPhotos} tone="cust" />
            )}
          </div>
        )}

        {/* ── 3. The three data points ── */}
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

        {/* ── 4. Coverage + Fix next. The Coverage card carries the second Ask Ticket
               ingress; "Fix next" deliberately does NOT, because it is already a
               recommendation and turning a recommendation into a recommendation would
               be a loop, not an answer. ── */}
        <div className="img-grid2">
          {/* Coverage checklist */}
          <TkCard
            className="img-coverage"
            tBubble={
              <VizTBubble
                viz={{
                  domain: "content",
                  metric: "Listing photo coverage",
                  value: `${a.coveredCount} essentials covered out of ${a.essentialTotal}`,
                  entityType: "location",
                  source: "Business listing data",
                  locationId,
                }}
              />
            }
          >
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
