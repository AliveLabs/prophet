// ---------------------------------------------------------------------------
// Deterministic menu extraction from a page's markdown.
//
// WHY THIS EXISTS
// Menu acquisition used to be one nondeterministic model call per page (Firecrawl JSON
// mode) over page content that is itself deterministic. Measured 2026-08-14 against the
// live sites:
//
//   * The markdown Firecrawl returns for a page is byte-stable. sugarbacon.com/dinner-menu
//     returned 10,520-10,521 chars on every read, with and without the render actions, with
//     and without the scrape cache. fogharbor.com/menu returned 29,727 chars every time.
//   * The MODEL over that identical markdown is not. fogharbor.com/menu yielded 69, 80 and
//     79 items across three back-to-back runs (run 1 silently dropped the whole "Happy Hour
//     Food" category), and category NAMES churned run to run ("Red Wine" / "Red Wines" /
//     "Red"), which fragments both mergeExtractedMenus and unionRecentMenus.
//   * In the worst case the model returns a single category and stops. That is the whole of
//     the stored 12-to-169-item swing on one restaurant: a thin read is not a broken page,
//     it is the model returning one section of a page whose text was fully present.
//
// So the model is the fallback for hard pages, not the default for easy ones. This module
// is the default: pure, total, and free.
//
// SCOPE. This parser only claims priced menus, which is what the product reasons about
// (price positioning, coverage, change detection). A page it cannot read credibly returns
// credible:false and the caller escalates to the model.
// ---------------------------------------------------------------------------

// Structurally compatible with ExtractedMenu in lib/providers/firecrawl.ts. Declared here
// rather than imported so this module stays dependency-free (firecrawl.ts imports IT).
export type ParsedMenuItem = {
  name: string
  description: string | null
  price: string | null
  priceValue: number | null
  tags: string[]
  itemKind: string | null
}

export type ParsedMenuCategory = {
  name: string
  items: ParsedMenuItem[]
}

export type ParsedMenu = {
  currency: string | null
  categories: ParsedMenuCategory[]
}

export type MarkdownMenuParse = {
  menu: ParsedMenu | null
  itemsTotal: number
  categoriesTotal: number
  pricedItems: number
  /** Good enough to skip the model entirely. */
  credible: boolean
  /**
   * Worth keeping even though it is not credible: the items it found are priced, there are
   * just too few of them to be sure the page was read whole. A caller that has decided not
   * to spend a model call should still take these rather than store nothing.
   */
  usable: boolean
  /** Why the parse was or was not credible. Recorded in parseMeta.notes. */
  reason: string
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Below this a deterministic parse is not worth trusting over the model. */
export const MIN_CREDIBLE_ITEMS = 8
/** Share of parsed items that must carry a price before the parse is credible. */
const MIN_PRICED_SHARE = 0.6
/**
 * Price sanity bounds. The upper bound is what keeps years (2026), zip codes and phone
 * fragments out of the price field; a menu item above it is rare enough that losing it
 * beats importing a year as a price.
 */
const MIN_PRICE = 0.25
const MAX_PRICE = 999.99
/**
 * Minimum priced-looking lines before a page is worth handing to the model at all. Below
 * this the page is a blog post, a homepage or a contact page, and today we pay for an LLM
 * extraction on every one of them.
 */
export const MIN_PRICE_SIGNALS_FOR_MODEL = 6

// ---------------------------------------------------------------------------
// Line cleaning
// ---------------------------------------------------------------------------

const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g
const ESCAPE_RE = /\\([\\|*_~[\]().$#+-])/g

/** Strip markdown decoration while PRESERVING runs of spaces (they are a price separator). */
function stripInline(line: string): string {
  return line
    .replace(IMAGE_RE, " ")
    .replace(LINK_RE, "$1")
    .replace(ESCAPE_RE, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/ /g, " ")
    .replace(/\r/g, "")
    .trimEnd()
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Names that are navigation, legal or layout furniture rather than menu items. */
const JUNK_NAME_RE =
  /^(home|menu|menus|contact|contact us|about|about us|reservations?|order online|gift cards?|careers|privacy policy|terms(?: & conditions)?|follow us|hours|location|locations|directions|sitemap|search|newsletter|subscribe|read more|learn more|view menu|back to top|copyright|all rights reserved)\b/i

const PHONE_RE = /\(\d{3}\)\s*\d{3}[-.\s]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/
const YEARISH_RE = /\b(19|20)\d{2}\b/

// ---------------------------------------------------------------------------
// Price primitives
// ---------------------------------------------------------------------------

const NUMBER = String.raw`\d{1,4}(?:[.,]\d{1,2})?`
const BARE_PRICE_RE = new RegExp(String.raw`^\$?\s*(${NUMBER})\s*$`)
const PRICE_THEN_LABEL_RE = new RegExp(String.raw`^\$?\s*(${NUMBER})\s+(\S.*)$`)
const LABEL_THEN_PRICE_RE = new RegExp(String.raw`^(\S.*?)\s+\$?\s*(${NUMBER})$`)
/** A trailing price on an un-piped line: needs a currency mark, dot leaders, a dash or a wide gap. */
const TRAILING_PRICE_RE = new RegExp(
  String.raw`^(.*?)(?:\s*[–—-]\s*|\s*\.{2,}\s*|\s{2,}|\s+)\$\s*(${NUMBER})\s*$`
)
const TRAILING_DECIMAL_RE = new RegExp(
  String.raw`^(.*?)(?:\s*[–—-]\s*|\s*\.{2,}\s*|\s{2,})\$?\s*(\d{1,4}[.,]\d{2})\s*$`
)
/** A size suffix on the name root, so "Filet 6 oz" roots to "Filet" for the next variant. */
const SIZE_SUFFIX_RE = /\s+\d{1,3}(?:\.\d+)?\s*(?:oz|ounces?|lbs?|g|kg|ml|cl|l|pcs?|pieces?|in|inch|")\.?$/i
/** A trailing portion label ("½ dozen", "5 oz", "Small") that names the first price variant. */
const SIZE_LABEL_RE =
  /\s((?:[½¼¾]|\d{1,3}(?:\.\d+)?)\s*(?:dozen|oz|ounces?|pcs?|pieces?|glass|bottle|cup|bowl|small|large|lbs?)\b.*)$/i
/** Any priced-looking token; used only to decide whether a page is worth a model call. */
const PRICE_SIGNAL_RE = new RegExp(String.raw`\$\s?\d|\|\s*\$?\d{1,4}(?:[.,]\d{1,2})?\s*(?:\||$)`, "gm")

function toPriceValue(raw: string): number | null {
  const value = Number(raw.replace(",", "."))
  if (!Number.isFinite(value)) return null
  if (value < MIN_PRICE || value > MAX_PRICE) return null
  return Math.round(value * 100) / 100
}

type Variant = { label: string | null; price: string; priceValue: number }

function makeVariant(raw: string): Variant | null {
  const value = toPriceValue(raw)
  if (value === null) return null
  return { label: null, price: raw.replace(",", "."), priceValue: value }
}

/**
 * Parse one candidate item line into a name plus its price variants.
 *
 * Handles the shapes real restaurant markdown actually produces:
 *   "Fried Green Tomatoes | 12"          -> one item at 12
 *   "Caesar Salad | Small 6 | Large 12"  -> two labelled items
 *   "Filet 6 oz | 35 10 oz | 49"         -> "Filet 6 oz" @35 and "Filet 10 oz" @49
 *   "Liberty School 14|50"               -> glass/bottle pair, priced at the glass
 *   "Clam Chowder $12.99"                -> one item at 12.99
 *   "Tomahawk 40 oz | Mrkt"              -> a named item with no price
 * Returns null when the line carries no name, i.e. it is not an item at all.
 */
export function parseItemLine(text: string): { name: string; variants: Variant[] } | null {
  const segments = text.split("|").map((s) => s.trim()).filter((s) => s.length > 0)
  if (segments.length === 0) return null

  if (segments.length === 1) {
    const single = segments[0]

    // Several currency-marked prices on one line are size variants:
    //   "Kumamoto Oysters ½ dozen $29 dozen $54"
    // The label for a price is the text immediately BEFORE it, which is the dominant
    // ordering on restaurant pages. Lines that put the size AFTER the price still yield
    // every price and a sane name, just with the labels shifted by one.
    const moneyRe = new RegExp(String.raw`\$\s?(${NUMBER})`, "g")
    const money = Array.from(single.matchAll(moneyRe))
    if (money.length >= 2) {
      let name = squash(single.slice(0, money[0].index))
      let firstLabel: string | null = null
      const sized = SIZE_LABEL_RE.exec(name)
      if (sized) {
        firstLabel = squash(sized[1])
        name = squash(name.slice(0, sized.index))
      }
      if (!name) return null
      const variants: Variant[] = []
      for (let k = 0; k < money.length; k++) {
        const variant = makeVariant(money[k][1])
        if (!variant) continue
        const label =
          k === 0
            ? firstLabel
            : squash(single.slice(money[k - 1].index! + money[k - 1][0].length, money[k].index))
        variants.push({ ...variant, label: label ? squash(`${name} (${label})`) : name })
      }
      if (variants.length > 0) return { name, variants }
    }

    const match = TRAILING_PRICE_RE.exec(single) ?? TRAILING_DECIMAL_RE.exec(single)
    if (!match) return null
    const name = squash(match[1])
    const variant = makeVariant(match[2])
    if (!name || !variant) return null
    return { name, variants: [variant] }
  }

  const first = segments[0]
  const rest = segments.slice(1)

  // Wine-list shape: the name itself ends in a price and every following segment is a bare
  // alternate price (glass|bottle). Price at the first, which is what the page leads with.
  const leading = LABEL_THEN_PRICE_RE.exec(first)
  if (leading && rest.every((seg) => BARE_PRICE_RE.test(seg))) {
    const variant = makeVariant(leading[2])
    const name = squash(leading[1])
    if (name && variant) return { name, variants: [variant] }
  }

  const root = squash(first.replace(SIZE_SUFFIX_RE, ""))
  const variants: Variant[] = []
  let currentName = squash(first)

  for (const segment of rest) {
    const bare = BARE_PRICE_RE.exec(segment)
    if (bare) {
      const variant = makeVariant(bare[1])
      if (variant) variants.push({ ...variant, label: currentName })
      continue
    }
    const priceThenLabel = PRICE_THEN_LABEL_RE.exec(segment)
    if (priceThenLabel) {
      const variant = makeVariant(priceThenLabel[1])
      if (variant) variants.push({ ...variant, label: currentName })
      // The trailing text names the NEXT variant ("35 10 oz" = 35 here, "10 oz" next).
      currentName = squash(`${root} ${priceThenLabel[2]}`)
      continue
    }
    const labelThenPrice = LABEL_THEN_PRICE_RE.exec(segment)
    if (labelThenPrice) {
      const variant = makeVariant(labelThenPrice[2])
      if (variant) variants.push({ ...variant, label: squash(`${root} (${labelThenPrice[1]})`) })
      continue
    }
  }

  const name = squash(first)
  if (!name) return null
  return { name, variants }
}

// ---------------------------------------------------------------------------
// Item kind (deterministic, conservative)
// ---------------------------------------------------------------------------

const KIND_RULES: Array<{ kind: string; re: RegExp }> = [
  { kind: "combo_meal", re: /\bcombo\b|\bmeal deal\b|\bvalue meal\b|\b\d+\s*pc\.?\s*meal\b|\bmeal$/i },
  { kind: "family_pack", re: /\bfamily\b|\bparty pack\b|\bplatter\b|\bfeeds\b|\bbucket\b|\bcatering\b|\bbundle\b/i },
  { kind: "drink", re: /\bdrink|\bbeverage|\bcocktail|\bwine|\bbeer|\bsoda|\bcoffee|\btea\b|\bspirit|\bmargarita|\bmartini|\bmimosa|\bwhiskey|\bbourbon|\bsangria|\blemonade|\bjuice\b|\bseltzer|\bsmoothie|\bshake\b/i },
  { kind: "dessert", re: /\bdessert|\bsweets?\b|\bice cream\b|\bsundae|\bcheesecake|\bcobbler|\bbrownie|\bpie\b|\bcake\b|\bcookie/i },
  { kind: "side", re: /\bsides?\b|\bfries\b|\btots\b|\bslaw\b|\bside salad\b|\badd[- ]?ons?\b|\bextras?\b/i },
  { kind: "condiment", re: /\bsauces?\b|\bdips?\b|\bdressings?\b|\bcondiments?\b/i },
  { kind: "entree", re: /\bentr[ée]es?\b|\bmains?\b|\bsandwich|\bburger|\bhandheld|\bpizza|\btacos?\b|\bplates?\b|\bbowls?\b|\bpasta|\bsteak|\bsalads?\b|\bstarters?\b|\bappetizers?\b|\bspecialt/i },
]

/** Best-effort kind from the category name first, then the item name. null when unclear. */
export function classifyItemKind(itemName: string, categoryName: string): string | null {
  for (const source of [categoryName, itemName]) {
    for (const rule of KIND_RULES) {
      if (rule.re.test(source)) return rule.kind
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

function detectCurrency(markdown: string): string | null {
  if (/[$]\s?\d/.test(markdown)) return "USD"
  if (/€\s?\d|\d\s?€/.test(markdown)) return "EUR"
  if (/£\s?\d/.test(markdown)) return "GBP"
  return null
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

type HeadingLine = { index: number; level: number; text: string }

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/

/** Count of priced-looking lines. Cheap gate on "is there a menu here at all". */
export function priceSignalCount(markdown: string): number {
  PRICE_SIGNAL_RE.lastIndex = 0
  return (markdown.match(PRICE_SIGNAL_RE) ?? []).length
}

function isJunk(name: string): boolean {
  if (!name) return true
  if (name.length > 120) return true
  if (JUNK_NAME_RE.test(name)) return true
  if (PHONE_RE.test(name)) return true
  // A "name" that opens with a price or carries no letters is a mis-split, not a dish.
  if (/^[$€£]/.test(name)) return true
  if (!/[a-z]/i.test(name)) return true
  return false
}

export function parseMenuMarkdown(markdown: string | null | undefined): MarkdownMenuParse {
  const empty: MarkdownMenuParse = {
    menu: null,
    itemsTotal: 0,
    categoriesTotal: 0,
    pricedItems: 0,
    credible: false,
    usable: false,
    reason: "no markdown",
  }
  if (!markdown || !markdown.trim()) return empty

  const rawLines = markdown.split("\n")
  const cleaned = rawLines.map((line) => stripInline(line))

  // Pass 1 — headings, and which of them carry a price.
  const headings: HeadingLine[] = []
  const pricedLevels = new Map<number, number>()
  for (let i = 0; i < rawLines.length; i++) {
    const match = HEADING_RE.exec(rawLines[i].trim())
    if (!match) continue
    const text = stripInline(match[2])
    const level = match[1].length
    headings.push({ index: i, level, text })
    const parsed = parseItemLine(text)
    if (parsed && parsed.variants.length > 0) {
      pricedLevels.set(level, (pricedLevels.get(level) ?? 0) + 1)
    }
  }

  // Pass 2 — the level at which items live, when the page prices its items as headings.
  // Requires a real cluster: one stray priced heading is a banner, not a menu.
  let itemLevel: number | null = null
  let itemLevelCount = 0
  for (const [level, count] of pricedLevels) {
    if (count > itemLevelCount) {
      itemLevel = level
      itemLevelCount = count
    }
  }
  const headingMode = itemLevel !== null && itemLevelCount >= 3

  // Pass 3 — walk the document, assigning items to the category heading above them.
  const categories: ParsedMenuCategory[] = []
  const byName = new Map<string, ParsedMenuCategory>()
  let current: ParsedMenuCategory | null = null
  let pendingDescriptionFor: ParsedMenuItem[] | null = null

  // Returns the category rather than mutating `current` from inside a closure: the caller
  // assigns, which keeps TypeScript's narrowing of `current` honest at every use site.
  const openCategory = (name: string): ParsedMenuCategory => {
    const key = name.toLowerCase()
    const existing = byName.get(key)
    if (existing) return existing
    const created: ParsedMenuCategory = { name, items: [] }
    byName.set(key, created)
    categories.push(created)
    return created
  }

  /** Append an item (and its variants) to a category. Returns what it created, for descriptions. */
  const pushItems = (
    parsed: { name: string; variants: Variant[] },
    category: ParsedMenuCategory
  ): ParsedMenuItem[] => {
    const made: ParsedMenuItem[] = []
    if (parsed.variants.length === 0) {
      if (isJunk(parsed.name)) return []
      made.push({
        name: parsed.name,
        description: null,
        price: null,
        priceValue: null,
        tags: [],
        itemKind: classifyItemKind(parsed.name, category.name),
      })
    } else {
      for (const variant of parsed.variants) {
        const name = squash(variant.label ?? parsed.name)
        if (isJunk(name)) continue
        made.push({
          name,
          description: null,
          price: variant.price,
          priceValue: variant.priceValue,
          tags: [],
          itemKind: classifyItemKind(name, category.name),
        })
      }
    }
    for (const item of made) {
      if (!category.items.some((existing) => existing.name.toLowerCase() === item.name.toLowerCase())) {
        category.items.push(item)
      }
    }
    return made
  }

  for (let i = 0; i < rawLines.length; i++) {
    const rawTrimmed = rawLines[i].trim()
    const line = cleaned[i]

    if (!rawTrimmed) continue

    const headingMatch = HEADING_RE.exec(rawTrimmed)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = stripInline(headingMatch[2])
      const parsed = parseItemLine(text)
      const priced = !!parsed && parsed.variants.length > 0

      if (headingMode && priced && parsed && level === itemLevel) {
        current = current ?? openCategory("Menu")
        pendingDescriptionFor = pushItems(parsed, current)
        continue
      }

      if (headingMode && !priced && itemLevel !== null && level >= itemLevel) {
        // A same-or-deeper heading with no price inside a category that already has priced
        // items is a market-price item ("Tomahawk 40 oz | Mrkt"), not a new section.
        if (current && current.items.length > 0 && level === itemLevel && !isJunk(text)) {
          pendingDescriptionFor = pushItems({ name: squash(text), variants: [] }, current)
        }
        continue
      }

      if (!priced && !isJunk(text)) {
        current = openCategory(squash(text))
        pendingDescriptionFor = null
      }
      continue
    }

    if (headingMode) {
      // Body text under a heading-priced item is that item's description.
      if (pendingDescriptionFor && line && !line.startsWith("-") && !PHONE_RE.test(line)) {
        const description = squash(line)
        if (description && description.length <= 300 && !parseItemLine(description)) {
          for (const item of pendingDescriptionFor) {
            if (!item.description) item.description = description
          }
        }
        pendingDescriptionFor = null
      }
      continue
    }

    // Line-driven mode: pages that list items as bullets or plain text under section
    // headings. Fog Harbor is the reference shape — "- Starters" is a section, "- Crab
    // Cakes $20" is an item, and the unbulleted line under it is that item's description.
    const bullet = /^\s*[-*+]\s+/.test(line)
    const body = line.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\|/, "").replace(/\|\s*$/, "").trim()
    if (!body || body.length > 300) continue
    if (PHONE_RE.test(body)) continue

    const parsed = YEARISH_RE.test(body) ? null : parseItemLine(body)
    if (parsed && parsed.variants.length > 0) {
      current = current ?? openCategory("Menu")
      pendingDescriptionFor = pushItems(parsed, current)
      continue
    }

    // A section label carries no price. A priced line that failed to parse is a mis-split
    // item, and promoting it to a category would bury the items that follow it.
    if (bullet && body.length <= 60 && !/[$€£]/.test(body) && !/[.:;,!?]$/.test(body) && !isJunk(body)) {
      current = openCategory(squash(body))
      pendingDescriptionFor = null
      continue
    }

    if (pendingDescriptionFor && !bullet && body.length <= 300) {
      const description = squash(body)
      if (description) {
        for (const item of pendingDescriptionFor) {
          if (!item.description) item.description = description
        }
      }
      pendingDescriptionFor = null
    }
  }

  // Only emptiness disqualifies a category here: a section that collected priced items has
  // earned its place even if its name looks like furniture. Junk names are screened at the
  // point a category is OPENED, which is where nav and footer headings get rejected.
  const kept = categories.filter((c) => c.items.length > 0)
  const itemsTotal = kept.reduce((sum, c) => sum + c.items.length, 0)
  const pricedItems = kept.reduce(
    (sum, c) => sum + c.items.filter((i) => i.priceValue !== null).length,
    0
  )

  if (itemsTotal === 0) {
    return { ...empty, reason: "deterministic parse found no priced items" }
  }

  const menu = { currency: detectCurrency(markdown), categories: kept }
  const base = { menu, itemsTotal, categoriesTotal: kept.length, pricedItems }
  const pricedShare = pricedItems / itemsTotal

  if (pricedShare < MIN_PRICED_SHARE) {
    return {
      ...base,
      credible: false,
      usable: false,
      reason: `only ${pricedItems}/${itemsTotal} parsed items carried a price`,
    }
  }
  if (itemsTotal < MIN_CREDIBLE_ITEMS) {
    return {
      ...base,
      credible: false,
      usable: true,
      reason: `deterministic parse found only ${itemsTotal} items (min ${MIN_CREDIBLE_ITEMS})`,
    }
  }

  return {
    ...base,
    credible: true,
    usable: true,
    reason: `Parsed deterministically from page markdown (${itemsTotal} items across ${kept.length} categories)`,
  }
}
