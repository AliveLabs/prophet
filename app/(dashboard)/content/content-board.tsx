"use client"

// The Pass — the Content & Menu Intelligence board, REBUILT to Concept A's structure.
//
// This is a STRUCTURE rebuild (not a reskin): a 2-col HERO for the location's live
// website + a detected-features chip wall → a menu CARD with kit-styled type/category
// tabs and a copyable item grid → an honest "you vs competitor" head-to-head price
// block + gap soft-panels, all composed from the shared `components/ticket` kit.
//
// The page (page.tsx) owns ALL data fetching/server logic; this island receives plain,
// already-derived data (no server imports) and changes only the PRESENTATION. The shared
// components/content/* (MenuViewer, MenuCompare) are intentionally NOT edited — their
// presentation is re-implemented here per the file-lane rules.
//
// Honest framing: every price shown is a REAL published menu price scraped from the
// operator's or a competitor's own public menu — not POS/covers/revenue. Comparisons are
// labeled "you vs <competitor>" and prices as "avg published price".

import { useMemo, useState, type ReactNode } from "react"
import {
  RevealOnView,
  TkSectionHead,
  TkCard,
  TkSoftPanel,
  TkHero,
  TkChip,
  TkButton,
  TkConfidence,
  TkH2HBars,
  TkDrawer,
  TkEmptyState,
  TkToastProvider,
  TkTooltipLayer,
  useTkToast,
} from "@/components/ticket"
import type {
  SiteContentSnapshot,
  MenuSnapshot,
  MenuCategory,
  MenuType,
} from "@/lib/content/types"

/* ── shared bits of derived data the island renders ─────────────────────── */
export type CompetitorMenuDisplay = {
  competitorName: string
  categories: MenuCategory[]
  avgPrice: number | null
  itemCount: number
}

type ContentBoardProps = {
  locationName: string
  website: string | null
  screenshotUrl: string | null
  menuScreenshotUrl: string | null
  siteContent: SiteContentSnapshot | null
  menu: MenuSnapshot | null
  locAvgPrice: number | null
  competitorMenus: CompetitorMenuDisplay[]
}

const MENU_TYPE_LABELS: Record<MenuType, string> = {
  dine_in: "Dine-In",
  catering: "Catering",
  banquet: "Banquet",
  happy_hour: "Happy Hour",
  kids: "Kids",
  other: "Other",
}

const CONF_LEVEL = {
  high: "high",
  medium: "medium",
  low: "directional",
} as const

/* ── icons (inline; match the Pass icon weight) ─────────────────────────── */
const GLOBE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
  </svg>
)
const MENU_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
)
const FEATURE_ON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
)
const FEATURE_OFF = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
)

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host
  } catch {
    return url
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Website hero — screenshot (or gradient canvas) + a live link.
   ════════════════════════════════════════════════════════════════════════ */
function WebsiteHero({
  locationName,
  website,
  screenshotUrl,
  features,
}: {
  locationName: string
  website: string | null
  screenshotUrl: string | null
  features: ReactNode
}) {
  const href = website
    ? website.startsWith("http")
      ? website
      : `https://${website}`
    : null

  const photo = screenshotUrl ? (
    <div className="content-shot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={screenshotUrl} alt={`Live screenshot of ${locationName}'s website`} />
      <span className="content-shot-veil" aria-hidden="true" />
    </div>
  ) : undefined

  return (
    <TkHero
      title={locationName}
      titleId="content-hero-title"
      photo={photo}
      photoLabel={website ? hostOf(website) : "No website on file"}
      venueChip={
        <>
          {GLOBE_ICON}
          {website ? hostOf(website) : "Site"}
        </>
      }
      chips={
        <>
          <TkChip family="menu">Your storefront</TkChip>
          <span className="content-hero-sub">What your customers see online</span>
        </>
      }
      lede={
        href ? (
          <>
            We read this site for menu, pricing, and the features customers expect —{" "}
            <a className="content-hero-link" href={href} target="_blank" rel="noopener noreferrer">
              open it &rarr;
            </a>
          </>
        ) : (
          "Add a website on Locations so we can read your menu, pricing, and customer-facing features."
        )
      }
      actions={
        <a className="content-hero-link content-change-url" href="/locations">
          Change tracked URL
        </a>
      }
    >
      {features}
    </TkHero>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Detected features — a chip wall (present = teal, missing = muted).
   ════════════════════════════════════════════════════════════════════════ */
function FeatureWall({ site }: { site: SiteContentSnapshot }) {
  const d = site.detected
  const rows: Array<{ label: string; active: boolean }> = [
    { label: "Online Reservations", active: d.reservation },
    { label: "Online Ordering", active: d.onlineOrdering },
    { label: "Private Dining", active: d.privateDining },
    { label: "Catering", active: d.catering },
    { label: "Happy Hour", active: d.happyHour },
    d.deliveryPlatforms.length > 0
      ? { label: `Delivery · ${d.deliveryPlatforms.join(", ")}`, active: true }
      : { label: "Delivery Platforms", active: false },
  ]
  const onCount = rows.filter((r) => r.active).length

  return (
    <div className="content-features">
      <div className="content-feat-head">
        <span className="content-feat-lbl">Features on your site</span>
        <span className="content-feat-count">
          {onCount} of {rows.length} detected
        </span>
      </div>
      <div className="content-feat-wall">
        {rows.map((r) => (
          <span
            key={r.label}
            className={`content-feat ${r.active ? "is-on" : "is-off"}`}
            data-tip={r.active ? "Detected on your website" : "Not detected — customers may expect this"}
            data-tipv={r.label}
          >
            <span className="content-feat-ic" aria-hidden="true">
              {r.active ? FEATURE_ON : FEATURE_OFF}
            </span>
            {r.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Menu card — kit-styled type/category tabs + a copyable item grid.
   ════════════════════════════════════════════════════════════════════════ */
function MenuCard({
  menu,
  menuScreenshotUrl,
}: {
  menu: MenuSnapshot
  menuScreenshotUrl: string | null
}) {
  const toast = useTkToast()
  const [shotOpen, setShotOpen] = useState(false)

  const categories = menu.categories
  const menuTypes = useMemo(() => {
    const t = new Set<MenuType>()
    for (const c of categories) t.add(c.menuType ?? "dine_in")
    return Array.from(t)
  }, [categories])

  const [activeType, setActiveType] = useState<MenuType>(menuTypes[0] ?? "dine_in")
  const [activeCat, setActiveCat] = useState(0)

  const filteredCats = useMemo(() => {
    if (menuTypes.length <= 1) return categories
    return categories.filter((c) => (c.menuType ?? "dine_in") === activeType)
  }, [categories, activeType, menuTypes.length])

  const active = filteredCats[activeCat] ?? filteredCats[0]
  const conf = (CONF_LEVEL[menu.parseMeta.confidence] ?? "directional") as
    | "high"
    | "medium"
    | "directional"

  function copyMenu() {
    const lines: string[] = []
    for (const cat of filteredCats) {
      lines.push(cat.name.toUpperCase())
      for (const it of cat.items) {
        lines.push(`  ${it.name}${it.price ? ` — ${it.price}` : ""}`)
      }
      lines.push("")
    }
    const text = lines.join("\n").trim()
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
    toast("Menu copied to clipboard.")
  }

  return (
    <TkCard className="content-menu-card">
      {/* head */}
      <div className="content-menu-head">
        <div className="content-menu-title">
          <span className="content-menu-ic" aria-hidden="true">{MENU_ICON}</span>
          <div>
            <h4>Your published menu</h4>
            <p>
              {menu.parseMeta.itemsTotal} item{menu.parseMeta.itemsTotal === 1 ? "" : "s"} ·{" "}
              {categories.length} categor{categories.length === 1 ? "y" : "ies"}
              {menu.currency ? ` · ${menu.currency}` : ""}
            </p>
          </div>
        </div>
        <div className="content-menu-meta">
          <TkConfidence level={conf} label={`${menu.parseMeta.confidence} read`} />
          <TkButton variant="add" onClick={copyMenu} aria-label="Copy menu to clipboard">
            Copy menu
          </TkButton>
        </div>
      </div>

      {/* menu-type tabs */}
      {menuTypes.length > 1 && (
        <div className="content-tabs content-tabs-type" role="tablist" aria-label="Menu types">
          {menuTypes.map((mt) => {
            const count = categories
              .filter((c) => (c.menuType ?? "dine_in") === mt)
              .reduce((s, c) => s + c.items.length, 0)
            const on = mt === activeType
            return (
              <button
                key={mt}
                role="tab"
                aria-selected={on}
                className={`content-tab ${on ? "is-on" : ""}`}
                onClick={() => {
                  setActiveType(mt)
                  setActiveCat(0)
                }}
              >
                {MENU_TYPE_LABELS[mt]}
                <span className="content-tab-n">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* category tabs */}
      <div className="content-tabs content-tabs-cat" role="tablist" aria-label="Categories">
        {filteredCats.map((cat, idx) => {
          const on = idx === activeCat
          return (
            <button
              key={cat.name}
              role="tab"
              aria-selected={on}
              className={`content-tab content-tab-cat ${on ? "is-on" : ""}`}
              onClick={() => setActiveCat(idx)}
            >
              {cat.name}
              <span className="content-tab-n">{cat.items.length}</span>
            </button>
          )
        })}
      </div>

      {/* items */}
      {active && (
        <div className="content-items">
          {active.items.map((item, idx) => (
            <TkSoftPanel key={`${item.name}-${idx}`} className="content-item">
              <div className="content-item-top">
                <h5>{item.name}</h5>
                {item.price && <span className="content-item-price">{item.price}</span>}
              </div>
              {item.description && <p className="content-item-desc">{item.description}</p>}
              {item.tags.length > 0 && (
                <div className="content-item-tags">
                  {item.tags.map((t) => (
                    <span key={t} className="content-item-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </TkSoftPanel>
          ))}
        </div>
      )}

      {/* parse notes + screenshot affordance */}
      {(menu.parseMeta.notes.length > 0 || menuScreenshotUrl) && (
        <div className="content-menu-foot">
          {menuScreenshotUrl && (
            <button type="button" className="content-shot-link" onClick={() => setShotOpen(true)}>
              View the menu page we read &rarr;
            </button>
          )}
          {menu.parseMeta.notes.length > 0 && (
            <p className="content-parse-notes">
              <span>How we read it:</span> {menu.parseMeta.notes.join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* screenshot drawer */}
      {menuScreenshotUrl && (
        <TkDrawer
          open={shotOpen}
          onClose={() => setShotOpen(false)}
          chip={<TkChip family="menu">Menu page · as we read it</TkChip>}
          title="The page we read your menu from"
        >
          <p className="tk-muted">
            This is the exact page we scraped. If items look wrong, the source page may have changed —
            refresh to re-read it.
          </p>
          <div className="content-shot-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={menuScreenshotUrl} alt="Screenshot of the menu page we read" />
          </div>
        </TkDrawer>
      )}
    </TkCard>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Compare — honest "you vs competitor" price head-to-head + gap panels.
   ════════════════════════════════════════════════════════════════════════ */
function filterByType(cats: MenuCategory[], mt: MenuType): MenuCategory[] {
  return cats.filter((c) => (c.menuType ?? "dine_in") === mt)
}
function avgPrice(cats: MenuCategory[]): number | null {
  const prices: number[] = []
  for (const cat of cats) {
    for (const it of cat.items) {
      if (it.priceValue != null && it.priceValue > 0) prices.push(it.priceValue)
    }
  }
  return prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null
}
function uniqueItems(comp: MenuCategory[], loc: MenuCategory[]): string[] {
  const have = new Set(loc.flatMap((c) => c.items.map((i) => i.name.toLowerCase().trim())))
  const out: string[] = []
  for (const cat of comp) {
    for (const it of cat.items) {
      if (!have.has(it.name.toLowerCase().trim())) out.push(it.name)
    }
  }
  return out
}

function CompareBoard({
  locationName,
  locationCategories,
  locationAvgPrice,
  competitors,
}: {
  locationName: string
  locationCategories: MenuCategory[]
  locationAvgPrice: number | null
  competitors: CompetitorMenuDisplay[]
}) {
  const allTypes = useMemo(() => {
    const t = new Set<MenuType>()
    for (const c of locationCategories) t.add(c.menuType ?? "dine_in")
    for (const comp of competitors) for (const c of comp.categories) t.add(c.menuType ?? "dine_in")
    return Array.from(t)
  }, [locationCategories, competitors])

  const [compareType, setCompareType] = useState<MenuType>(allTypes[0] ?? "dine_in")
  const [selected, setSelected] = useState(0)
  const comp = competitors[selected] ?? competitors[0]

  const locCats = filterByType(locationCategories, compareType)
  const compCats = filterByType(comp.categories, compareType)
  const locAvg = avgPrice(locCats) ?? locationAvgPrice
  const compAvg = avgPrice(compCats) ?? comp.avgPrice
  const locCount = locCats.reduce((s, c) => s + c.items.length, 0)
  const compCount = compCats.reduce((s, c) => s + c.items.length, 0)

  const locCatNames = new Set(locCats.map((c) => c.name.toLowerCase().trim()))
  const missingCats = [...new Set(compCats.map((c) => c.name.toLowerCase().trim()))].filter(
    (c) => !locCatNames.has(c)
  )
  const compUnique = uniqueItems(compCats, locCats)

  // honest head-to-head rows. Bars are RELATIVE magnitudes (share of the pair), never faked.
  const h2hRows: Array<{
    metric: ReactNode
    side: "you" | "them"
    width: number
    verdict: ReactNode
    tip?: string
    tipValue?: string
  }> = []

  if (locAvg != null && compAvg != null) {
    const sum = locAvg + compAvg
    // higher avg price => bigger bar; verdict is neutral (neither is "winning" on price)
    const youHigher = locAvg >= compAvg
    h2hRows.push({
      metric: "Avg published price",
      side: youHigher ? "you" : "them",
      width: sum > 0 ? (Math.abs(locAvg - compAvg) / sum) * 100 + 18 : 18,
      verdict: youHigher
        ? `You +$${(locAvg - compAvg).toFixed(2)}`
        : `Them +$${(compAvg - locAvg).toFixed(2)}`,
      tip: `You $${locAvg.toFixed(2)} · ${comp.competitorName} $${compAvg.toFixed(2)}`,
      tipValue: "avg published price",
    })
  }
  if (locCount || compCount) {
    const sum = locCount + compCount
    const youMore = locCount >= compCount
    h2hRows.push({
      metric: "Items published",
      side: youMore ? "you" : "them",
      width: sum > 0 ? (Math.abs(locCount - compCount) / sum) * 100 + 18 : 18,
      verdict: youMore ? `You ${locCount} vs ${compCount}` : `Them ${compCount} vs ${locCount}`,
      tip: `${MENU_TYPE_LABELS[compareType]} menu`,
      tipValue: `you ${locCount} · them ${compCount}`,
    })
  }

  return (
    <div className="content-compare">
      <TkSectionHead
        title="You vs your competitors"
        sub="From each side's own published menu — no POS data"
      />

      {/* selectors */}
      <div className="content-compare-controls">
        {competitors.length > 1 && (
          <label className="content-select">
            <span>Compare against</span>
            <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
              {competitors.map((c, i) => (
                <option key={i} value={i}>
                  {c.competitorName}
                </option>
              ))}
            </select>
          </label>
        )}
        {allTypes.length > 1 && (
          <label className="content-select">
            <span>Menu</span>
            <select
              value={compareType}
              onChange={(e) => setCompareType(e.target.value as MenuType)}
            >
              {allTypes.map((mt) => (
                <option key={mt} value={mt}>
                  {MENU_TYPE_LABELS[mt]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* price face-off cards */}
      <div className="content-faceoff">
        <div className="content-faceoff-side is-you">
          <span className="content-fo-lbl">{locationName} · you</span>
          <span className="content-fo-val">{locAvg != null ? `$${locAvg.toFixed(2)}` : "—"}</span>
          <span className="content-fo-sub">
            avg {MENU_TYPE_LABELS[compareType].toLowerCase()} price · {locCount} items
          </span>
        </div>
        <span className="content-faceoff-vs" aria-hidden="true">vs</span>
        <div className="content-faceoff-side">
          <span className="content-fo-lbl">{comp.competitorName}</span>
          <span className="content-fo-val">{compAvg != null ? `$${compAvg.toFixed(2)}` : "—"}</span>
          <span className="content-fo-sub">
            avg {MENU_TYPE_LABELS[compareType].toLowerCase()} price · {compCount} items
          </span>
        </div>
      </div>

      {/* head-to-head bars */}
      {h2hRows.length > 0 && (
        <RevealOnView>
          <TkH2HBars
            rows={h2hRows}
            note="Bars show the gap between you and this competitor on each metric. Price isn't a winner — it's positioning."
          />
        </RevealOnView>
      )}

      {/* gaps */}
      <div className="content-gaps">
        {missingCats.length > 0 && (
          <TkSoftPanel className="content-gap-panel">
            <span className="content-gap-lbl">Categories they list that you don&apos;t</span>
            <div className="content-gap-chips">
              {missingCats.map((c) => (
                <span key={c} className="content-gap-chip">
                  {c}
                </span>
              ))}
            </div>
          </TkSoftPanel>
        )}
        {compUnique.length > 0 && (
          <TkSoftPanel className="content-gap-panel">
            <span className="content-gap-lbl">
              Items they offer that you don&apos;t ({compUnique.length})
            </span>
            <ul className="content-gap-list">
              {compUnique.slice(0, 12).map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
            {compUnique.length > 12 && (
              <span className="content-gap-more">+{compUnique.length - 12} more</span>
            )}
          </TkSoftPanel>
        )}
        {missingCats.length === 0 && compUnique.length === 0 && (
          <TkSoftPanel className="content-gap-panel content-gap-even">
            You match {comp.competitorName} on every category and item we can see in this menu.
          </TkSoftPanel>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   The board
   ════════════════════════════════════════════════════════════════════════ */
export default function ContentBoard({
  locationName,
  website,
  screenshotUrl,
  menuScreenshotUrl,
  siteContent,
  menu,
  locAvgPrice,
  competitorMenus,
}: ContentBoardProps) {
  const hasMenuItems = !!menu && menu.categories.length > 0
  const nothingYet = !siteContent && !menu

  return (
    <TkToastProvider>
      <div className="tk-kit content-board">
        <TkTooltipLayer />

        {nothingYet ? (
          <RevealOnView>
            <TkEmptyState
              icon={GLOBE_ICON}
              title="No content read yet"
              description="Run a content refresh and we'll read your website for menu items, pricing, screenshots, and the customer-facing features you offer — then line you up against your competitors."
            />
          </RevealOnView>
        ) : (
          <>
            {/* HERO — your storefront + features */}
            <RevealOnView>
              <WebsiteHero
                locationName={locationName}
                website={website}
                screenshotUrl={screenshotUrl}
                features={siteContent ? <FeatureWall site={siteContent} /> : null}
              />
            </RevealOnView>

            {/* MENU */}
            {hasMenuItems ? (
              <>
                <TkSectionHead
                  title="Your menu, as customers see it"
                  sub="Read from your live site"
                />
                <RevealOnView>
                  <MenuCard menu={menu!} menuScreenshotUrl={menuScreenshotUrl} />
                </RevealOnView>
              </>
            ) : menu && menu.categories.length === 0 ? (
              <RevealOnView>
                <TkEmptyState
                  icon={MENU_ICON}
                  title="No menu items found"
                  description={
                    menu.parseMeta.notes.length > 0
                      ? menu.parseMeta.notes.join(" · ")
                      : "We couldn't extract menu items from your website. Make sure your menu is on a readable page, then refresh."
                  }
                />
              </RevealOnView>
            ) : null}

            {/* COMPARE */}
            {hasMenuItems && competitorMenus.length > 0 ? (
              <RevealOnView>
                <CompareBoard
                  locationName={locationName}
                  locationCategories={menu!.categories}
                  locationAvgPrice={locAvgPrice}
                  competitors={competitorMenus}
                />
              </RevealOnView>
            ) : hasMenuItems ? (
              <>
                <TkSectionHead title="You vs your competitors" sub="Waiting on competitor menus" />
                <RevealOnView>
                  <TkEmptyState
                    title="No competitor menus to compare yet"
                    description="Once we've read a competitor's published menu, you'll see an honest price and item face-off here."
                  />
                </RevealOnView>
              </>
            ) : null}
          </>
        )}
      </div>
    </TkToastProvider>
  )
}
