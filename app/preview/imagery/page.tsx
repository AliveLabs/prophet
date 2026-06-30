// DEV/REVIEW-ONLY harness for ALT-160 — the Google-listing imagery modules.
// Renders the REAL <ListingCheck/> + <TheShelf/> with representative sample data
// (no auth / no DB), plus a per-post grade demo, inside the preview token surface.
// Prod-guarded by the preview layout (VERCEL_ENV !== production).

import ListingCheck from "@/components/imagery/listing-check"
import TheShelf from "@/components/imagery/the-shelf"
import type { PhotoRow } from "@/lib/places/listing-audit"
import type { PhotoCategory } from "@/lib/providers/photos"
import { TkSectionHead, TkSocialEmbed } from "@/components/ticket"
import "@/components/ticket/pass.css"
import "@/components/imagery/imagery.css"
import "@/app/(dashboard)/social/social.css"

// Build a sample own-listing photo row.
function row(
  category: PhotoCategory,
  opts: { lighting?: "professional" | "amateur" | "unknown"; customer?: boolean } = {},
): PhotoRow {
  return {
    analysis_result: {
      category,
      subcategory: "",
      tags: [],
      extracted_text: "",
      promotional_content: false,
      promotional_details: "",
      quality_signals: { lighting: opts.lighting ?? "professional", staging: "styled" },
      confidence: 0.8,
      notable_changes: "",
    },
    author_attribution: opts.customer ? [{ displayName: "A. Reviewer" }] : [],
  }
}

// Own listing: exterior covered, interior covered, dishes covered, signage thin,
// menu_board + team MISSING, a patio shot (makes patio a conditional essential),
// and a batch of customer-uploaded atmosphere shots (drives the owner/customer split).
const OWN_PHOTOS: PhotoRow[] = [
  row("exterior"),
  row("exterior", { customer: true }),
  row("interior", { lighting: "amateur" }),
  row("interior", { customer: true }),
  row("food_dish"),
  row("food_dish", { lighting: "amateur", customer: true }),
  row("food_dish", { customer: true }),
  row("signage"),
  row("patio_outdoor", { customer: true }),
  row("customer_atmosphere", { lighting: "amateur", customer: true }),
  row("customer_atmosphere", { lighting: "amateur", customer: true }),
  row("bar_drinks", { customer: true }),
]

// Two competitors; the first is the stronger listing (the Shelf benchmark).
const SHELF_COMPETITORS = [
  {
    id: "c1",
    name: "Rival Co.",
    rows: [
      row("exterior"), row("signage"), row("interior"), row("menu_board"),
      row("food_dish"), row("food_dish"), row("staff_team"), row("bar_drinks"),
    ],
  },
  {
    id: "c2",
    name: "Corner Spot",
    rows: [row("exterior", { lighting: "amateur" }), row("food_dish", { lighting: "amateur" })],
  },
]

export default function ImageryPreview() {
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">ALT-160</span>
        <h1 className="pv-h1">Google-listing imagery</h1>
        <p className="pv-sub">
          The own-listing modules that mount on the morning brief. Listing Check is a storefront
          audit (coverage punch-list + quality + who&apos;s shaping the picture); The Shelf compares
          your listing against the strongest in your set. Honest framing only — counts, percentages,
          and you-vs-them, never invented dollars or customer counts.
        </p>
      </div>
      <hr className="pv-rule" />

      <div className="tk-kit" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ListingCheck photos={OWN_PHOTOS} hasPlaceId />
        <TheShelf ownPhotos={OWN_PHOTOS} competitors={SHELF_COMPETITORS} />

        {/* Per-post grade demo — the read that now rides on each social card. */}
        <section className="img-mod">
          <TkSectionHead title="Per-post grade (social cards)" sub="The vision read now shown on each post, next to engagement" />
          <div className="tk-grid sp-grid" style={{ marginTop: 12 }}>
            <TkSocialEmbed
              handle="Your account"
              verified
              subline="Your account · 2d ago"
              caption="Fresh batch out of the fryer 🔥"
              grade={
                <div className="sp-grade">
                  <span className="sp-grade-q sp-grade-q-high">Pro-shot</span>
                  <span className="sp-grade-cat">Dish</span>
                  <span className="sp-grade-cue">Steam / motion</span>
                  <span className="sp-grade-cue">Strong plating</span>
                </div>
              }
              stats={[
                { value: "1.2K", label: "Likes" },
                { value: "84", label: "Comments" },
                { value: "100%", label: "of peak" },
              ]}
            />
            <TkSocialEmbed
              handle="Your account"
              verified
              subline="Your account · 5d ago"
              caption="Quiet afternoon at the counter."
              grade={
                <div className="sp-grade">
                  <span className="sp-grade-q sp-grade-q-mid">Casual shot</span>
                  <span className="sp-grade-cat">Interior</span>
                </div>
              }
              stats={[
                { value: "210", label: "Likes" },
                { value: "9", label: "Comments" },
                { value: "18%", label: "of peak" },
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
