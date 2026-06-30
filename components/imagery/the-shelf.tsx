// The Shelf (ALT-160) — your Google-listing imagery vs the strongest listing in
// your competitor set, on the same honest signals (coverage, polish, volume).
// Sibling to Listing Check; reuses the kit's head-to-head bars so it reads like
// the rest of the product's "you vs them". Server component — pure render.

import { buildShelf, type PhotoRow, type CompetitorPhotoGroup } from "@/lib/places/listing-audit"
import { TkH2HBars, RevealOnView } from "@/components/ticket"
import "./imagery.css"

export default function TheShelf({
  ownPhotos,
  competitors,
}: {
  ownPhotos: PhotoRow[]
  competitors: CompetitorPhotoGroup[]
}) {
  const shelf = buildShelf(ownPhotos, competitors)
  // Needs own photos AND at least one competitor with photos — otherwise there's
  // nothing honest to compare, so the module hides itself.
  if (!shelf) return null

  return (
    <section className="img-mod img-shelf">
      <RevealOnView>
        <TkH2HBars
          title="Your listing vs your set"
          rows={shelf.rows}
          note={
            shelf.benchmarkName
              ? `Measured against ${shelf.benchmarkName} — the strongest listing in your set.`
              : undefined
          }
        />
      </RevealOnView>
    </section>
  )
}
