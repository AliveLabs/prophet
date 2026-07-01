"use client"

// The Pass — the locations board (client island).
//
// STRUCTURE rebuild of the old "stack of bordered rows": a lead HERO for the
// first location (gradient canvas + identity + what-we-track body + add CTA),
// then the rest as ranked TkPlayCard tiles in a grid. Per-location DETAIL
// (Google profile, hours, reviews, weather, content/menu status) + the EDIT
// form live in a TkDrawer (right-slide desktop / bottom-sheet mobile) so the
// board itself stays scannable — exactly the home flagship's card→drawer pattern.
//
// Data + the server actions (createLocationFromPlaceAction, updateLocationAction,
// deleteLocationAction) are passed in from the server page UNCHANGED. This island
// only owns presentation + the open/close + a remove confirm.

import { useState, type CSSProperties, type ReactNode } from "react"
import LocationAddForm from "@/components/places/location-add-form"
import LocationAddressForm from "./location-address-form"
import MiniMap from "@/components/places/mini-map"
import { HeroImage } from "../hero-image"
import {
  TkHero,
  TkPlayCard,
  TkCard,
  TkSoftPanel,
  TkSectionHead,
  TkButton,
  TkChip,
  TkConfidence,
  TkWinFlag,
  TkVizCap,
  TkDrawer,
  TkEmptyState,
  RevealOnView,
  type TkConfidenceLevel,
} from "@/components/ticket"

/* ── view model the server page builds (honest, no fabricated metrics) ── */
export type LocationCard = {
  id: string
  name: string
  /** "Coffee shop", "Restaurant", … from Google primaryType (humanized server-side) */
  primaryType: string | null
  cityLine: string
  address: string | null
  rating: number | null
  reviewCount: number | null
  phone: string | null
  website: string | null
  mapsUri: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  hours: string[]
  reviews: Array<{ text: string; who: string; when: string; rating: number | null }>
  /** own-listing Google cover (pickCoverPhoto) — fills the lead hero; null ⇒ gradient canvas */
  coverUrl: string | null
  /** normalized focal point of the cover, for anchoring its crop (null → center) */
  coverFocal: { x: number; y: number } | null
  screenshotUrl: string | null
  menuItemCount: number
  menuConfidence: string | null
  lastScrapedAt: string | null
  /** the form's current persisted values */
  editName: string
  editAddress: string
  editWebsite: string
  /** the website Google detected, if it differs from the saved override */
  detectedWebsite: string | null
  weather: {
    temp: string
    condition: string | null
    humidity: number | null
    windText: string | null
    iconUrl: string | null
  } | null
}

const IconMapPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
)
const IconStar = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 6-5.2-2.7-5.2 2.7 1-6-4.3-4.2 5.9-.9L12 3Z" />
  </svg>
)
const IconChat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M8 12h8M8 8h6" />
    <path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4V6Z" />
  </svg>
)
const IconPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7A2 2 0 0 1 22 16.9Z" />
  </svg>
)
const IconGlobe = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
  </svg>
)
const IconClock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
)
const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const IconBuilding = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M19 21V11a1 1 0 0 0-1-1h-3" />
    <path d="M8 7h2M8 11h2M8 15h2" />
  </svg>
)

/* the data signals we read per location → a small "coverage" line + status pip.
   This is honest: it reflects what Google + our scrape actually returned, not a
   fabricated health score. */
function coverageOf(loc: LocationCard): { fresh: number; total: number; level: TkConfidenceLevel } {
  const checks = [
    loc.rating != null, // Google profile
    loc.menuItemCount > 0, // menu scraped
    loc.screenshotUrl != null, // site content
    loc.weather != null, // local weather feed
  ]
  const fresh = checks.filter(Boolean).length
  const total = checks.length
  const level: TkConfidenceLevel = fresh >= 3 ? "high" : fresh === 2 ? "medium" : "directional"
  return { fresh, total, level }
}

/* ── one location's full profile, shown in the drawer body ── */
function LocationDetail({
  loc,
  updateAction,
  updateAddressAction,
}: {
  loc: LocationCard
  updateAction: (formData: FormData) => void
  updateAddressAction: (formData: FormData) => void
}) {
  const cov = coverageOf(loc)
  return (
    <>
      <div className="loc-detail-chips">
        {loc.rating != null ? (
          <TkChip family="social" className="loc-stat-chip">
            <IconStar /> {loc.rating}
          </TkChip>
        ) : null}
        {loc.reviewCount != null ? (
          <TkChip family="competitive" className="loc-stat-chip">
            <IconChat /> {loc.reviewCount} reviews
          </TkChip>
        ) : null}
        {loc.phone ? (
          <span className="loc-meta-pill">
            <IconPhone /> {loc.phone}
          </span>
        ) : null}
        {loc.website ? (
          <a className="loc-meta-pill loc-link-pill" href={loc.website} target="_blank" rel="noreferrer">
            <IconGlobe /> Website
          </a>
        ) : null}
      </div>

      {loc.address ? (
        <p className="loc-detail-addr">
          <IconMapPin /> {loc.address}
        </p>
      ) : null}

      {/* what we're tracking — honest coverage read */}
      <TkSoftPanel className="loc-coverage">
        <TkVizCap left="What we're tracking" right={`${cov.fresh} of ${cov.total} live`} />
        <ul className="loc-cov-list">
          <li className={loc.rating != null ? "loc-on" : "loc-off"}>
            <span className="loc-cov-mark" aria-hidden="true">{loc.rating != null ? "✓" : "—"}</span>
            Google profile {loc.rating != null ? `· ${loc.rating}★` : "· not reached"}
          </li>
          <li className={loc.menuItemCount > 0 ? "loc-on" : "loc-off"}>
            <span className="loc-cov-mark" aria-hidden="true">{loc.menuItemCount > 0 ? "✓" : "—"}</span>
            Menu {loc.menuItemCount > 0 ? `· ${loc.menuItemCount} items` : loc.menuConfidence ? "· none found" : "· not scraped yet"}
          </li>
          <li className={loc.screenshotUrl != null ? "loc-on" : "loc-off"}>
            <span className="loc-cov-mark" aria-hidden="true">{loc.screenshotUrl != null ? "✓" : "—"}</span>
            Website content {loc.screenshotUrl != null ? "· captured" : "· not captured"}
          </li>
          <li className={loc.weather != null ? "loc-on" : "loc-off"}>
            <span className="loc-cov-mark" aria-hidden="true">{loc.weather != null ? "✓" : "—"}</span>
            Local weather {loc.weather ? `· ${loc.weather.temp}` : "· unavailable"}
          </li>
        </ul>
        {loc.lastScrapedAt ? (
          <p className="loc-cov-foot">Last refreshed {loc.lastScrapedAt}</p>
        ) : (
          <p className="loc-cov-foot">First data pull runs after a location is added.</p>
        )}
      </TkSoftPanel>

      {/* visuals: storefront capture + map */}
      <div className="loc-visuals">
        {loc.screenshotUrl ? (
          <div className="loc-shot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={loc.screenshotUrl} alt={`${loc.name} website`} />
          </div>
        ) : null}
        <MiniMap
          lat={loc.lat}
          lng={loc.lng}
          title={loc.name}
          className="loc-map"
          mapsUri={loc.mapsUri}
          placeId={loc.placeId}
          address={loc.address}
        />
      </div>

      {/* live weather */}
      {loc.weather ? (
        <TkSoftPanel className="loc-weather">
          <TkVizCap left="Local weather" right={loc.weather.condition ?? "—"} />
          <div className="loc-weather-row">
            {loc.weather.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={loc.weather.iconUrl} alt="" aria-hidden="true" />
            ) : null}
            <span className="loc-weather-temp tk-mono">{loc.weather.temp}</span>
            <span className="loc-weather-detail">
              {loc.weather.humidity != null ? `Humidity ${loc.weather.humidity}%` : null}
              {loc.weather.humidity != null && loc.weather.windText ? " · " : null}
              {loc.weather.windText}
            </span>
          </div>
        </TkSoftPanel>
      ) : null}

      {/* operating hours */}
      {loc.hours.length ? (
        <TkSoftPanel className="loc-hours">
          <TkVizCap left={<span className="loc-cap-ic"><IconClock /> Operating hours</span>} />
          <div className="loc-hours-grid">
            {loc.hours.map((line) => (
              <span key={line} className="tk-mono">{line}</span>
            ))}
          </div>
        </TkSoftPanel>
      ) : null}

      {/* recent reviews */}
      {loc.reviews.length ? (
        <TkSoftPanel className="loc-reviews">
          <TkVizCap left="Recent reviews" right="from Google" />
          <div className="loc-review-list">
            {loc.reviews.slice(0, 2).map((r, i) => (
              <div className="loc-review" key={i}>
                <p>{r.text}</p>
                <span className="loc-review-meta tk-mono">
                  {r.who}
                  {r.rating != null ? ` · ${"★".repeat(Math.max(0, Math.min(5, r.rating)))}` : ""}
                  {r.when ? ` · ${r.when}` : ""}
                </span>
              </div>
            ))}
          </div>
        </TkSoftPanel>
      ) : null}

      {/* edit form — kit-styled inputs, same updateLocationAction */}
      <details className="loc-edit">
        <summary>
          <span className="loc-edit-car" aria-hidden="true">▸</span> Edit details
        </summary>
        <form action={updateAction} className="loc-edit-form">
          <input type="hidden" name="location_id" value={loc.id} />
          <label className="loc-field">
            <span className="loc-field-lbl">Display name</span>
            <input name="name" defaultValue={loc.editName} className="loc-input" />
            <span className="loc-field-hint">
              Shown across your dashboard (e.g. &ldquo;Cane&rsquo;s 141&rdquo;). Doesn&rsquo;t change
              your Google listing.
            </span>
          </label>
          <label className="loc-field">
            <span className="loc-field-lbl">Website URL</span>
            <input
              name="website"
              type="url"
              defaultValue={loc.editWebsite}
              placeholder="https://example.com/your-branch-page"
              className="loc-input"
            />
            {loc.detectedWebsite && loc.editWebsite !== loc.detectedWebsite ? (
              <span className="loc-field-hint">
                Google detected: <b>{loc.detectedWebsite}</b>
              </span>
            ) : null}
            <span className="loc-field-hint">
              Override with a branch-specific URL for Content &amp; Visibility tracking.
            </span>
          </label>
          <TkButton variant="add" type="submit">
            <IconCheck /> Save changes
          </TkButton>
        </form>

        {/* ALT-224 — address is edited separately, map-verified (its own form). */}
        <LocationAddressForm
          locationId={loc.id}
          currentAddress={loc.editAddress || loc.address}
          action={updateAddressAction}
        />
      </details>
    </>
  )
}

/* ── the board ── */
export function LocationsBoard({
  locations,
  organizationId,
  error,
  createAction,
  updateAction,
  updateAddressAction,
  deleteAction,
}: {
  locations: LocationCard[]
  organizationId: string
  error?: string
  createAction: (formData: FormData) => void
  updateAction: (formData: FormData) => void
  updateAddressAction: (formData: FormData) => void
  deleteAction: (formData: FormData) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const open = locations.find((l) => l.id === openId) ?? null
  const lead = locations[0] ?? null
  const rest = locations.slice(1)

  const addCta = (
    <TkButton variant="add" onClick={() => setAddOpen(true)}>
      <IconPlus /> Add a location
    </TkButton>
  )

  /* card status: a win-flag for a strongly-rated, fully-tracked location;
     otherwise the shared confidence-pips encoding for coverage strength. */
  function statusFor(loc: LocationCard): ReactNode {
    const cov = coverageOf(loc)
    if (loc.rating != null && loc.rating >= 4.5 && cov.fresh >= 3) return <TkWinFlag>Strong profile</TkWinFlag>
    return <TkConfidence level={cov.level} label={`${cov.fresh}/${cov.total} tracked`} />
  }

  function cardChips(loc: LocationCard): ReactNode {
    return (
      <>
        <TkChip family="competitive">{loc.primaryType ?? "Location"}</TkChip>
        {loc.rating != null ? (
          <span className="loc-inline-stat">
            <IconStar /> {loc.rating}
            {loc.reviewCount != null ? <span className="loc-inline-sub">· {loc.reviewCount}</span> : null}
          </span>
        ) : null}
      </>
    )
  }

  return (
    <div className="loc-board tk-kit">
      {error ? (
        <div className="loc-error" role="alert">
          <span className="pass-dot" aria-hidden="true" />
          {decodeURIComponent(error)}
        </div>
      ) : null}

      {locations.length === 0 ? (
        /* ── EMPTY STATE ── */
        <RevealOnView>
          <TkEmptyState
            icon={<IconBuilding />}
            title="No locations yet"
            description="Add your first location and we'll start the data pull — its own competitors, signals, and morning brief follow within a day."
            action={addCta}
          />
        </RevealOnView>
      ) : (
        <>
          {/* ── LEAD HERO (first location) ── */}
          {lead ? (
            <RevealOnView className="loc-hero-wrap">
              <TkHero
                title={lead.name}
                chips={
                  <>
                    <TkChip family="competitive">{lead.primaryType ?? "Location"}</TkChip>
                    {statusFor(lead)}
                  </>
                }
                lede={
                  <>
                    {lead.cityLine}
                    {lead.address ? <> · {lead.address}</> : null}
                    {". "}
                    Each location runs its own competitor set, signals, and daily brief.
                  </>
                }
                photo={
                  <HeroImage
                    url={lead.coverUrl}
                    focal={lead.coverFocal}
                    label={lead.name}
                    fallback={<LocationCanvas label={lead.cityLine} />}
                  />
                }
                venueChip={
                  <>
                    <IconMapPin /> {lead.cityLine}
                  </>
                }
                actions={
                  <>
                    <TkButton variant="act" onClick={() => setOpenId(lead.id)}>
                      View profile &amp; tracking
                    </TkButton>
                    {addCta}
                  </>
                }
              >
                <div className="loc-hero-stats">
                  {lead.rating != null ? (
                    <span className="loc-hero-stat">
                      <span className="loc-hero-stat-v tk-mono">{lead.rating}</span>
                      <span className="loc-hero-stat-k">Rating</span>
                    </span>
                  ) : null}
                  {lead.reviewCount != null ? (
                    <span className="loc-hero-stat">
                      <span className="loc-hero-stat-v tk-mono">{lead.reviewCount}</span>
                      <span className="loc-hero-stat-k">Reviews</span>
                    </span>
                  ) : null}
                  {lead.menuItemCount > 0 ? (
                    <span className="loc-hero-stat">
                      <span className="loc-hero-stat-v tk-mono">{lead.menuItemCount}</span>
                      <span className="loc-hero-stat-k">Menu items</span>
                    </span>
                  ) : null}
                  {lead.weather ? (
                    <span className="loc-hero-stat">
                      <span className="loc-hero-stat-v tk-mono">{lead.weather.temp}</span>
                      <span className="loc-hero-stat-k">Now</span>
                    </span>
                  ) : null}
                </div>
              </TkHero>
            </RevealOnView>
          ) : null}

          {/* ── THE REST as a grid of cards ── */}
          {rest.length ? (
            <>
              <TkSectionHead
                title="Your other locations"
                sub={`${rest.length} more in this account`}
                className="loc-sec"
              />
              <RevealOnView className="tk-grid loc-grid" stagger>
                {rest.map((loc, i) => (
                  <div key={loc.id} style={{ "--tk-i": i } as CSSProperties}>
                    <TkPlayCard
                      family="competitive"
                      icon={<IconBuilding />}
                      title={loc.name}
                      confidence={statusFor(loc)}
                      chips={cardChips(loc)}
                      summary={
                        <>
                          {loc.cityLine}
                          {loc.menuItemCount > 0 ? <> · menu tracked</> : null}
                        </>
                      }
                      onTitleClick={() => setOpenId(loc.id)}
                      actions={
                        <TkButton variant="act" onClick={() => setOpenId(loc.id)}>
                          View profile
                        </TkButton>
                      }
                    >
                      {loc.address ? (
                        <p className="loc-card-addr">
                          <IconMapPin /> {loc.address}
                        </p>
                      ) : null}
                    </TkPlayCard>
                  </div>
                ))}
              </RevealOnView>
            </>
          ) : (
            /* single location → still offer the add path as a soft panel */
            <RevealOnView>
              <TkCard className="loc-add-cta-card">
                <div className="loc-add-cta-text">
                  <h3>Add another location</h3>
                  <p>Each one gets its own competitors, signals, and morning brief.</p>
                </div>
                {addCta}
              </TkCard>
            </RevealOnView>
          )}
        </>
      )}

      {/* ── DETAIL DRAWER (per location) ── */}
      <TkDrawer
        open={open != null}
        onClose={() => {
          setOpenId(null)
          setConfirmId(null)
        }}
        chip={open ? <TkChip family="competitive">{open.primaryType ?? "Location"}</TkChip> : null}
        title={open?.name}
      >
        {open ? (
          <>
            <LocationDetail loc={open} updateAction={updateAction} updateAddressAction={updateAddressAction} />
            {/* remove — two-step confirm so it isn't a one-tap mistake */}
            <div className="loc-remove">
              {confirmId === open.id ? (
                <form action={deleteAction} className="loc-remove-confirm">
                  <input type="hidden" name="location_id" value={open.id} />
                  <span className="loc-remove-q">Remove {open.name}? This stops all tracking.</span>
                  <div className="loc-remove-actions">
                    <TkButton variant="dismiss" type="submit">Yes, remove</TkButton>
                    <TkButton variant="ghost" type="button" onClick={() => setConfirmId(null)}>
                      Cancel
                    </TkButton>
                  </div>
                </form>
              ) : (
                <TkButton variant="ghost" onClick={() => setConfirmId(open.id)}>
                  Remove this location
                </TkButton>
              )}
            </div>
          </>
        ) : null}
      </TkDrawer>

      {/* ── ADD DRAWER (place picker) ── */}
      <TkDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        chip={<span className="loc-add-chip tk-eyebrow">Add a location</span>}
        title="Add a location"
      >
        <p className="tk-muted loc-add-lede">
          Find the place on Google — we take it from there. The first data pull starts
          immediately, and its competitors, signals, and morning brief follow.
        </p>
        <TkSoftPanel className="loc-add-panel">
          <LocationAddForm
            organizationId={organizationId}
            action={createAction}
            buttonLabel="Add this location"
          />
        </TkSoftPanel>
      </TkDrawer>
    </div>
  )
}

/* a soft multi-hue canvas for the hero photo slot — scales to any location type,
   no fabricated storefront imagery. Mirrors the home flagship's PassHeroCanvas. */
function LocationCanvas({ label }: { label?: string }) {
  return (
    <div className="tk-photo loc-canvas" data-label={label} aria-hidden="true">
      <svg className="tk-stadium" viewBox="0 0 400 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="loc-glow" cx="24%" cy="10%" r="92%">
            <stop offset="0%" stopColor="var(--slate)" stopOpacity="0.5" />
            <stop offset="52%" stopColor="var(--rust)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="400" height="380" fill="url(#loc-glow)" />
        <g fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="2">
          <path d="M-20 250 Q120 170 220 230 T420 200" />
          <path d="M-20 300 Q140 230 240 280 T420 250" />
        </g>
        {/* a simple skyline mark — neutral to any location type */}
        <g fill="rgba(255,255,255,.12)">
          <rect x="120" y="210" width="34" height="120" rx="2" />
          <rect x="166" y="178" width="40" height="152" rx="2" />
          <rect x="218" y="226" width="30" height="104" rx="2" />
          <rect x="260" y="198" width="36" height="132" rx="2" />
        </g>
      </svg>
      <div className="tk-veil" />
    </div>
  )
}
