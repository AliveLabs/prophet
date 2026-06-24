import { describe, it, expect, beforeEach } from "vitest"
import {
  loadActiveKnowledge,
  effectiveKnowledgeVersion,
  clearKnowledgeCache,
  type KnowledgeInjection,
  type KnowledgeSnippet,
} from "@/lib/skills/knowledge-feeds"
import { buildSkillPrompt } from "@/lib/skills/prompt-kit"
import {
  passesDistillGate,
  corroborate,
  parseRssItems,
  extractArticleText,
  extractArticleLinks,
  fetchSourceItems,
  runIngestion,
  ARTICLE_FETCH_CONCURRENCY,
  type DistillVerdict,
  type DistilledHit,
  type SourceRow,
  type HttpFetch,
  type IngestStore,
} from "@/lib/skills/ingest-knowledge"
import type { Transport } from "@/lib/ai/provider"
import { foodPairingSkill } from "@/lib/skills/food-pairing/skill"
import type { Dossier } from "@/lib/insights/dossier/types"

// ── A minimal dossier good enough for prompt building (only the fields buildSkillPrompt reads). ────
function makeDossier(): Dossier {
  return {
    locationId: "loc-1",
    tier: { tier: 2 },
    ruleOutputs: [],
    profile: {
      locationId: "loc-1",
      name: "Test Diner",
      timezone: "America/Chicago",
      voiceTone: "casual",
      attributes: { cuisine: "American", priceTier: "$$" },
      capability: { liveChannels: ["instagram"] },
    },
  } as unknown as Dossier
}

// ── A loose-store stub matching the loader's chained eq/eq/in surface. ─────────────────────────────
function knowledgeStore(rows: Record<string, unknown>[] | null, opts: { error?: boolean; throws?: boolean } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    in: async () => {
                      if (opts.throws) throw new Error("table does not exist")
                      return { data: rows, error: opts.error ? { message: "boom" } : null }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

const baseRow = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "k1",
  skill_id: "food-pairing",
  scope: "global",
  scope_id: null,
  learning_kind: "external_trend",
  title: "Hot sauce is trending",
  snippet: "Per NRA What's Hot, bold global hot sauces are a durable upsell; feature one as a limited topping.",
  confidence: 80,
  effective_from: "2026-01-01T00:00:00Z",
  effective_to: null,
  ...over,
})

beforeEach(() => clearKnowledgeCache())

describe("loadActiveKnowledge — fail-soft (the floor is today)", () => {
  it("returns EMPTY (never throws) when the table does not exist", async () => {
    const out = await loadActiveKnowledge("food-pairing", { locationId: "loc-1" }, { client: knowledgeStore(null, { throws: true }) })
    expect(out).toEqual({ global: [], scoped: [], globalVersion: "" })
  })

  it("returns EMPTY when the query errors", async () => {
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(null, { error: true }) })
    expect(out.global).toEqual([])
    expect(out.scoped).toEqual([])
    expect(out.globalVersion).toBe("")
  })

  it("returns EMPTY when there are no active rows", async () => {
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([]) })
    expect(out.global).toHaveLength(0)
    expect(out.globalVersion).toBe("")
  })

  it("drops malformed rows (empty snippet / unknown scope) rather than injecting noise", async () => {
    const out = await loadActiveKnowledge(
      "food-pairing",
      {},
      { client: knowledgeStore([baseRow({ id: "bad", snippet: "  " }), baseRow({ id: "ok2", title: "Real one" })]) },
    )
    expect(out.global.map((s) => s.id)).toEqual(["ok2"])
  })
})

describe("loadActiveKnowledge — scope split (cache discipline)", () => {
  it("puts global rows in .global and matching org/location rows in .scoped", async () => {
    const rows = [
      baseRow({ id: "g1", scope: "global", scope_id: null }),
      baseRow({ id: "o1", scope: "org", scope_id: "org-1", title: "Org learning" }),
      baseRow({ id: "l1", scope: "location", scope_id: "loc-1", title: "Loc learning" }),
      baseRow({ id: "other", scope: "location", scope_id: "loc-999", title: "Other loc" }),
    ]
    const out = await loadActiveKnowledge(
      "food-pairing",
      { organizationId: "org-1", locationId: "loc-1" },
      { client: knowledgeStore(rows) },
    )
    expect(out.global.map((s) => s.id)).toEqual(["g1"])
    expect(out.scoped.map((s) => s.id).sort()).toEqual(["l1", "o1"])
    // a different location's row is ignored.
    expect(out.scoped.find((s) => s.id === "other")).toBeUndefined()
  })

  it("never injects a kind the skill did not declare (acceptedLearningKinds defense in depth)", async () => {
    // The skill accepts ONLY external_trend/editorial — a feedback_pattern row is active in-window
    // and well-formed, but must STILL be dropped (defense in depth on top of scope/window/status).
    const rows = [
      baseRow({ id: "trend", learning_kind: "external_trend" }),
      baseRow({ id: "edit", learning_kind: "editorial", title: "Editorial note" }),
      baseRow({ id: "fb", learning_kind: "feedback_pattern", title: "Feedback pattern" }),
      baseRow({ id: "q", learning_kind: "question_demand", title: "Question demand" }),
      baseRow({ id: "fb-loc", scope: "location", scope_id: "loc-1", learning_kind: "feedback_pattern", title: "Scoped feedback" }),
    ]
    const out = await loadActiveKnowledge(
      "food-pairing",
      { locationId: "loc-1" },
      { client: knowledgeStore(rows), acceptedKinds: ["external_trend", "editorial"] },
    )
    expect(out.global.map((s) => s.id).sort()).toEqual(["edit", "trend"])
    // the disallowed kinds are gone from BOTH global and scoped — even the in-scope location row.
    expect(out.scoped).toHaveLength(0)
    expect([...out.global, ...out.scoped].some((s) => s.learningKind === "feedback_pattern")).toBe(false)
    expect([...out.global, ...out.scoped].some((s) => s.learningKind === "question_demand")).toBe(false)
  })

  it("accepts ALL kinds when no acceptedKinds filter is passed (back-compat: no learning hook)", async () => {
    const rows = [
      baseRow({ id: "trend", learning_kind: "external_trend" }),
      baseRow({ id: "fb", learning_kind: "feedback_pattern", title: "Feedback pattern" }),
    ]
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(rows) })
    expect(out.global.map((s) => s.id).sort()).toEqual(["fb", "trend"])
  })

  it("a declared-but-EMPTY acceptedKinds injects nothing (the floor)", async () => {
    const rows = [baseRow({ id: "trend", learning_kind: "external_trend" })]
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(rows), acceptedKinds: [] })
    expect(out.global).toHaveLength(0)
    expect(out.globalVersion).toBe("")
  })

  it("filters out rows outside the active window (self-retiring trends)", async () => {
    const rows = [
      baseRow({ id: "expired", effective_to: "2020-01-01T00:00:00Z" }),
      baseRow({ id: "live", title: "Still live", effective_to: "2999-01-01T00:00:00Z" }),
    ]
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(rows), nowMs: Date.parse("2026-06-24T00:00:00Z") })
    expect(out.global.map((s) => s.id)).toEqual(["live"])
  })
})

describe("effectiveKnowledgeVersion — cache key includes the version", () => {
  const inj = (global: KnowledgeSnippet[]): KnowledgeInjection => ({
    global,
    scoped: [],
    globalVersion: global.length ? "abc1234" : "",
  })
  const snip = (id: string): KnowledgeSnippet => ({
    id,
    skillId: "food-pairing",
    scope: "global",
    scopeId: null,
    learningKind: "external_trend",
    title: "t",
    snippet: "s",
    confidence: 50,
  })

  it("EMPTY global set → base version UNCHANGED (byte-identical-cache-key property)", () => {
    expect(effectiveKnowledgeVersion("food-pairing@v1", inj([]))).toBe("food-pairing@v1")
  })

  it("non-empty global set → base + hash tag", () => {
    const v = effectiveKnowledgeVersion("food-pairing@v1", inj([snip("a")]))
    expect(v).toBe("food-pairing@v1+fabc1234")
    expect(v).not.toBe("food-pairing@v1")
  })

  it("the loader's globalVersion is order-independent + changes when the set changes", async () => {
    const a = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([baseRow({ id: "x" }), baseRow({ id: "y", title: "Y" })]) })
    clearKnowledgeCache()
    // same two ids, reversed row order → same fingerprint (sorted ids).
    const b = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([baseRow({ id: "y", title: "Y" }), baseRow({ id: "x" })]) })
    expect(a.globalVersion).toBe(b.globalVersion)
    clearKnowledgeCache()
    // different id set → different fingerprint.
    const c = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([baseRow({ id: "z" })]) })
    expect(c.globalVersion).not.toBe(a.globalVersion)
  })
})

describe("prompt injection — placement + byte-identical floor", () => {
  const d = makeDossier()
  const TRENDS_HEADER = "CURRENT TRENDS & LEARNED PRIORS (informational; never override the operator's own reality or the evidence)"

  it("EMPTY active set leaves systemCached BYTE-IDENTICAL to today (no knowledge arg)", () => {
    const today = buildSkillPrompt(foodPairingSkill, d, { x: 1 })
    const withEmpty = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, { global: [], scoped: [], globalVersion: "" })
    expect(withEmpty.systemCached).toBe(today.systemCached)
    expect(withEmpty.system).toBe(today.system)
    // and the block is genuinely absent.
    expect(withEmpty.systemCached).not.toContain(TRENDS_HEADER)
  })

  it("injects the trends block AFTER the DOMAIN PLAYBOOK and BEFORE the RULES", () => {
    const knowledge: KnowledgeInjection = {
      global: [
        { id: "g", skillId: "food-pairing", scope: "global", scopeId: null, learningKind: "external_trend", title: "Hot honey", snippet: "Hot honey keeps trending; feature it on a sweet-heat item.", confidence: 80 },
      ],
      scoped: [],
      globalVersion: "deadbeef",
    }
    const out = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, knowledge)
    const sc = out.systemCached
    const idxPlaybook = sc.indexOf("DOMAIN PLAYBOOK:")
    const idxTrends = sc.indexOf(TRENDS_HEADER)
    const idxRules = sc.indexOf("RULES:")
    expect(idxPlaybook).toBeGreaterThanOrEqual(0)
    expect(idxTrends).toBeGreaterThan(idxPlaybook)
    expect(idxRules).toBeGreaterThan(idxTrends)
    expect(sc).toContain("Hot honey")
  })

  it("GLOBAL snippets ride systemCached; SCOPED snippets ride the volatile system block (cache discipline)", () => {
    const knowledge: KnowledgeInjection = {
      global: [{ id: "g", skillId: "food-pairing", scope: "global", scopeId: null, learningKind: "external_trend", title: "Global trend", snippet: "global snippet text", confidence: 70 }],
      scoped: [{ id: "l", skillId: "food-pairing", scope: "location", scopeId: "loc-1", learningKind: "feedback_pattern", title: "Local pattern", snippet: "scoped snippet text", confidence: 60 }],
      globalVersion: "v",
    }
    const out = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, knowledge)
    // global → cached prefix only; scoped → volatile system only. Never crossed.
    expect(out.systemCached).toContain("global snippet text")
    expect(out.systemCached).not.toContain("scoped snippet text")
    expect(out.system).toContain("scoped snippet text")
    expect(out.system).not.toContain("global snippet text")
    // adding ONLY a scoped snippet must NOT change systemCached vs. the global-only build (so a
    // per-location learning can never bust the shared 13-location prefix cache).
    const globalOnly = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, { global: knowledge.global, scoped: [], globalVersion: "v" })
    expect(out.systemCached).toBe(globalOnly.systemCached)
  })

  it("the injected block reasserts that trends NEVER override evidence/grounding (grounding stays sacred)", () => {
    const knowledge: KnowledgeInjection = {
      global: [{ id: "g", skillId: "food-pairing", scope: "global", scopeId: null, learningKind: "external_trend", title: "T", snippet: "s", confidence: 80 }],
      scoped: [],
      globalVersion: "v",
    }
    const out = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, knowledge)
    expect(out.systemCached).toContain("never cite a trend as an evidenceRef")
    expect(out.systemCached).toContain("the evidence wins")
    // the static GROUNDING rule is still present and untouched.
    expect(out.systemCached).toContain("allowedEvidenceRefs list below")
    expect(out.systemCached).toContain("If you cannot ground a play, do not make it.")
  })
})

// ── PIPELINE 1 validation gates ─────────────────────────────────────────────────────────────────
const src = (id: string, tier: 1 | 2 | 3): SourceRow => ({
  id,
  skillIds: ["food-pairing"],
  name: `Source ${id}`,
  vertical: "culinary",
  url: `https://example.com/${id}`,
  fetchStrategy: "rss",
  authKind: "none",
  trustTier: tier,
  enabled: true,
})
const verdict = (over: Partial<DistillVerdict>): DistillVerdict => ({
  snippet: "Durable tactic: feature a seasonal hot-honey item; it has lasting appeal.",
  title: "Hot honey demand",
  confidence: 80,
  attributable: true,
  ...over,
})

describe("adversarial distill gate (b)", () => {
  it("DROPS a low-confidence verdict and KEEPS a durable, attributable one", () => {
    expect(passesDistillGate(verdict({ confidence: 80, attributable: true }))).toBe(true)
    expect(passesDistillGate(verdict({ confidence: 30 }))).toBe(false) // below the floor
  })

  it("DROPS an unattributable verdict even at high confidence", () => {
    expect(passesDistillGate(verdict({ confidence: 95, attributable: false }))).toBe(false)
  })
})

describe("corroboration gate (c)", () => {
  it("a lone TIER-3 source caps at SHADOW (never active)", () => {
    const hits: DistilledHit[] = [{ verdict: verdict({ confidence: 95 }), source: src("t3", 3) }]
    const rows = corroborate("food-pairing", hits)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("shadow")
  })

  it(">=2 TIER-1 sources asserting the same trend AUTO-PROMOTE to active", () => {
    const hits: DistilledHit[] = [
      { verdict: verdict({ confidence: 75 }), source: src("a", 1) },
      { verdict: verdict({ confidence: 72 }), source: src("b", 1) },
    ]
    const rows = corroborate("food-pairing", hits)
    expect(rows).toHaveLength(1) // same normalized title → one corroborated row
    expect(rows[0].status).toBe("active")
    expect(rows[0].supportN).toBe(2)
    expect(rows[0].confidence).toBeGreaterThanOrEqual(75) // corroboration bonus applied
  })

  it("a single TIER-1 source lands at SHADOW (compute + observe, don't yet serve)", () => {
    const rows = corroborate("food-pairing", [{ verdict: verdict({ confidence: 65 }), source: src("a", 1) }])
    expect(rows[0].status).toBe("shadow")
  })

  it("writes external_trend rows with an active window (recency self-retire) and never relaxes grounding", () => {
    const now = Date.parse("2026-06-24T00:00:00Z")
    const rows = corroborate("food-pairing", [{ verdict: verdict({ confidence: 90 }), source: src("a", 1) }, { verdict: verdict({ confidence: 88 }), source: src("b", 1) }], { nowMs: now })
    expect(rows[0].effectiveToMs).toBeGreaterThan(rows[0].effectiveFromMs)
    expect(rows[0].provenance.streams).toEqual(["external"])
    // the row carries NO evidenceRefs field — a trend can never become a citable ref.
    expect("evidenceRefs" in rows[0]).toBe(false)
  })
})

describe("parseRssItems — dependency-free feed parsing", () => {
  it("extracts title + description + link from RSS items", () => {
    const xml = `<rss><channel>
      <item><title>Trend A</title><description>Body A</description><link>https://x/a</link></item>
      <item><title>Trend B</title><description><![CDATA[Body B & more]]></description><link>https://x/b</link></item>
    </channel></rss>`
    const items = parseRssItems(xml)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: "Trend A", body: "Body A", url: "https://x/a" })
    expect(items[1].body).toBe("Body B & more")
  })
})

// ── REAL-BODY EXTRACTION (the fix): pull article prose, not nav/teaser chrome ─────────────────────
// A canned article page: real chrome (nav/header/footer) wrapping a real <article> body. The
// distinctive nav string MUST be stripped; the article sentence MUST survive.
const NAV_STRING = "Product Pricing How it works Company Resources Login"
const ARTICLE_SENTENCE =
  "Local store marketing beats paid ads for an independent operator: sponsor a youth sports team and offer the roster a standing discount to build durable neighborhood loyalty."
function articleHtml(opts: { sentence?: string; wrap?: "article" | "main" | "role" | "p" } = {}): string {
  const sentence = opts.sentence ?? ARTICLE_SENTENCE
  const wrap = opts.wrap ?? "article"
  const inner = `<h1>How to grow with local marketing</h1><p>${sentence}</p><p>It compounds over months because the relationship outlives any single promotion.</p>`
  const bodyRegion =
    wrap === "article" ? `<article>${inner}</article>`
    : wrap === "main" ? `<main>${inner}</main>`
    : wrap === "role" ? `<section role="main">${inner}</section>`
    : inner // bare <p> blocks, no semantic container
  return `<!doctype html><html><head><title>Local marketing — Owner Blog</title><style>.x{color:red}</style></head><body>
    <nav><a href="/pricing">Pricing</a> ${NAV_STRING}</nav>
    <header><a href="/login">Login</a> Site header chrome</header>
    ${bodyRegion}
    <aside><a href="/category/news">More in News</a> sidebar promo blurb</aside>
    <footer>${NAV_STRING} Footer copyright 2026</footer>
    <script>var tracking = "Product Pricing How it works analytics noise";</script>
  </body></html>`
}

// A canned INDEX/listing page: nav chrome + a list of article links + non-article (category/login) links.
function indexHtml(): string {
  return `<!doctype html><html><head><title>Owner Blog</title></head><body>
    <nav><a href="/pricing">Pricing</a><a href="/login">Login</a><a href="/category/marketing">Marketing</a> ${NAV_STRING}</nav>
    <main>
      <a href="/blog/local-store-marketing-playbook-for-restaurants">Local store marketing playbook</a>
      <a href="https://www.owner.com/blog/loyalty-program-tactics-that-work">Loyalty tactics</a>
      <a href="/blog">Blog</a>
      <a href="/category/seo">SEO category</a>
      <a href="/blog/email-capture-at-the-table">Email capture</a>
      <a href="#top">Back to top</a>
      <a href="https://other-host.com/blog/not-our-host">Off-host link</a>
    </main>
    <footer><a href="/about">About</a> ${NAV_STRING}</footer>
  </body></html>`
}

describe("extractArticleText — keeps the body, strips the chrome (the fix)", () => {
  it("keeps the <article> body and STRIPS nav/header/footer/script", () => {
    const out = extractArticleText(articleHtml({ wrap: "article" }))
    expect(out).toContain("Local store marketing beats paid ads")
    expect(out).not.toContain("Product Pricing How it works")
    expect(out).not.toContain("Footer copyright")
    expect(out).not.toContain("Login")
    expect(out).not.toContain("analytics noise")
  })

  it("falls back to <main>, then [role=main]", () => {
    expect(extractArticleText(articleHtml({ wrap: "main" }))).toContain("Local store marketing beats")
    expect(extractArticleText(articleHtml({ wrap: "role" }))).toContain("Local store marketing beats")
  })

  it("collects the largest <p> cluster when there's no semantic container", () => {
    const out = extractArticleText(articleHtml({ wrap: "p" }))
    expect(out).toContain("Local store marketing beats")
    expect(out).not.toContain("Product Pricing How it works")
  })

  it("returns '' for a page with no real body (so the caller can fall back to the teaser)", () => {
    expect(extractArticleText("<html><body><nav>just nav</nav></body></html>")).toBe("")
    expect(extractArticleText("")).toBe("")
  })

  it("caps the length", () => {
    const long = `<article><p>${"word ".repeat(5000)}</p></article>`
    expect(extractArticleText(long, 6000).length).toBeLessThanOrEqual(6000)
  })
})

describe("extractArticleLinks — picks article-looking links, drops nav/category/login", () => {
  it("returns same-host slug-like article links and drops nav/category/login/anchor/off-host", () => {
    const links = extractArticleLinks(indexHtml(), "https://www.owner.com/blog", 5)
    expect(links).toContain("https://www.owner.com/blog/local-store-marketing-playbook-for-restaurants")
    expect(links).toContain("https://www.owner.com/blog/loyalty-program-tactics-that-work")
    expect(links).toContain("https://www.owner.com/blog/email-capture-at-the-table")
    // dropped: bare /blog section root, /category/*, /login, /pricing, #top anchor, off-host.
    expect(links).not.toContain("https://www.owner.com/blog")
    expect(links.some((l) => l.includes("/category/"))).toBe(false)
    expect(links.some((l) => l.includes("/login"))).toBe(false)
    expect(links.some((l) => l.includes("/pricing"))).toBe(false)
    expect(links.some((l) => l.includes("other-host.com"))).toBe(false)
  })

  it("caps the number of links and dedupes", () => {
    const html = `<main>${Array.from({ length: 20 }, (_, i) => `<a href="/blog/article-number-${i}">a${i}</a>`).join("")}
      <a href="/blog/article-number-0">dupe</a></main>`
    const links = extractArticleLinks(html, "https://x.com/blog", 5)
    expect(links).toHaveLength(5)
    expect(new Set(links).size).toBe(5) // deduped
  })

  it("returns [] on a bad base url or empty html", () => {
    expect(extractArticleLinks("<a href='/blog/x-y'>x</a>", "not a url")).toEqual([])
    expect(extractArticleLinks("", "https://x.com/blog")).toEqual([])
  })
})

// ── fetchSourceItems — REAL article bodies via a deterministic, canned-HTML HttpFetch stub ─────────
type Hit = { url: string; init?: { headers?: Record<string, string> } }
function stubHttp(
  routes: Record<string, { ok?: boolean; status?: number; text: string } | "throw">,
  hits: Hit[] = [],
): HttpFetch {
  return async (url, init) => {
    hits.push({ url, init })
    const r = routes[url]
    if (r === "throw") throw new Error("network down")
    if (!r) return { ok: false, status: 404, text: async () => "" }
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => r.text }
  }
}
const rssSource = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: "s-rss", skillIds: ["grassroots"], name: "RSS Source", vertical: "marketing",
  url: "https://feed.example.com/feed/", fetchStrategy: "rss", authKind: "none", trustTier: 2, enabled: true, ...over,
})
const scrapeSource = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: "s-scrape", skillIds: ["grassroots"], name: "Owner Blog", vertical: "marketing",
  url: "https://www.owner.com/blog", fetchStrategy: "scrape", authKind: "none", trustTier: 2, enabled: true, ...over,
})

describe("fetchSourceItems — rss path follows the link → distills the ARTICLE, not the teaser", () => {
  it("follows the item link and returns the real article body (NOT the short teaser)", async () => {
    const feed = `<rss><channel>
      <item><title>Local marketing wins</title><description>Short teaser only.</description><link>https://feed.example.com/post/local</link></item>
    </channel></rss>`
    const http = stubHttp({
      "https://feed.example.com/feed/": { text: feed },
      "https://feed.example.com/post/local": { text: articleHtml() },
    })
    const items = await fetchSourceItems(rssSource(), http)
    expect(items).toHaveLength(1)
    expect(items[0].body).toContain("Local store marketing beats paid ads") // real article body
    expect(items[0].body).not.toContain("Short teaser only") // teaser was replaced
    expect(items[0].body).not.toContain("Product Pricing How it works") // chrome stripped
    expect(items[0].url).toBe("https://feed.example.com/post/local")
  })

  it("uses the FULL feed body directly (no second fetch) when content:encoded is already long", async () => {
    const fullBody = "Per the source, " + "durable operator tactic prose ".repeat(40) // > 600 chars
    const feed = `<rss><channel>
      <item><title>Full body item</title><content:encoded><![CDATA[${fullBody}]]></content:encoded><link>https://feed.example.com/post/full</link></item>
    </channel></rss>`
    const hits: Hit[] = []
    const http = stubHttp({ "https://feed.example.com/feed/": { text: feed } }, hits)
    const items = await fetchSourceItems(rssSource(), http)
    expect(items[0].body).toContain("durable operator tactic prose")
    // ONLY the feed was fetched — the link was not followed (full body already present).
    expect(hits.map((h) => h.url)).toEqual(["https://feed.example.com/feed/"])
  })

  it("falls back to the teaser when the linked article fetch FAILS (source still ok)", async () => {
    const feed = `<rss><channel>
      <item><title>Dead link item</title><description>Useful teaser fallback text.</description><link>https://feed.example.com/post/dead</link></item>
    </channel></rss>`
    const http = stubHttp({
      "https://feed.example.com/feed/": { text: feed },
      "https://feed.example.com/post/dead": "throw", // article fetch throws — caught, falls back
    })
    const items = await fetchSourceItems(rssSource(), http)
    expect(items).toHaveLength(1)
    expect(items[0].body).toBe("Useful teaser fallback text.")
  })

  it("falls back to the teaser when the article body extracts to '' (e.g. an all-nav page)", async () => {
    const feed = `<rss><channel>
      <item><title>Nav-only article</title><description>Teaser stands in.</description><link>https://feed.example.com/post/nav</link></item>
    </channel></rss>`
    const http = stubHttp({
      "https://feed.example.com/feed/": { text: feed },
      "https://feed.example.com/post/nav": { text: "<html><body><nav>only nav here</nav></body></html>" },
    })
    const items = await fetchSourceItems(rssSource(), http)
    expect(items[0].body).toBe("Teaser stands in.")
  })
})

describe("fetchSourceItems — scrape path: index → article links → bodies", () => {
  it("fetches the index, follows article links, and returns extracted article bodies", async () => {
    const http = stubHttp({
      "https://www.owner.com/blog": { text: indexHtml() },
      "https://www.owner.com/blog/local-store-marketing-playbook-for-restaurants": { text: articleHtml({ sentence: "Sponsor a youth sports team to win durable neighborhood loyalty over many seasons." }) },
      "https://www.owner.com/blog/loyalty-program-tactics-that-work": { text: articleHtml({ sentence: "A punch-card loyalty program lifts repeat visits for an independent operator without ad spend." }) },
      "https://www.owner.com/blog/email-capture-at-the-table": { text: articleHtml({ sentence: "Capture diner emails at the table with a QR code to build a marketing list you own outright." }) },
    })
    const items = await fetchSourceItems(scrapeSource(), http)
    expect(items.length).toBe(3)
    expect(items.map((i) => i.body).join(" ")).toContain("Sponsor a youth sports team")
    expect(items.map((i) => i.body).join(" ")).toContain("punch-card loyalty program")
    // chrome never leaks into any body.
    expect(items.every((i) => !i.body.includes("Product Pricing How it works"))).toBe(true)
  })

  it("a single dead article fetch does NOT fail the source (others still returned)", async () => {
    const http = stubHttp({
      "https://www.owner.com/blog": { text: indexHtml() },
      "https://www.owner.com/blog/local-store-marketing-playbook-for-restaurants": "throw", // dead
      "https://www.owner.com/blog/loyalty-program-tactics-that-work": { text: articleHtml({ sentence: "Loyalty punch cards drive durable repeat visits for a neighborhood restaurant." }) },
      "https://www.owner.com/blog/email-capture-at-the-table": { text: articleHtml({ sentence: "Collect emails at the table with a table-tent QR to own your marketing channel." }) },
    })
    const items = await fetchSourceItems(scrapeSource(), http)
    // the dead article is skipped; the source still yields the two good ones.
    expect(items.length).toBe(2)
    expect(items.map((i) => i.body).join(" ")).toContain("Loyalty punch cards")
  })

  it("falls back to the index page's own main content when NO article links are found", async () => {
    // An index with no slug-like links → extract the index's own body instead of windowing chrome.
    const http = stubHttp({
      "https://www.owner.com/blog": { text: articleHtml({ sentence: "This listing page itself carries the durable operator guidance as prose in its main region." }) },
    })
    const items = await fetchSourceItems(scrapeSource(), http)
    expect(items).toHaveLength(1)
    expect(items[0].body).toContain("durable operator guidance")
    expect(items[0].body).not.toContain("Product Pricing How it works")
  })

  it("a hard-403 index fetch THROWS (propagates to the caller → failure_count++)", async () => {
    const http = stubHttp({ "https://www.owner.com/blog": { ok: false, status: 403, text: "" } })
    await expect(fetchSourceItems(scrapeSource(), http)).rejects.toThrow("http_403")
  })

  it("scrape-browser-headers sends BROWSER_HEADERS on BOTH index and article fetches", async () => {
    const hits: Hit[] = []
    const http = stubHttp({
      "https://www.owner.com/blog": { text: indexHtml() },
      "https://www.owner.com/blog/local-store-marketing-playbook-for-restaurants": { text: articleHtml() },
      "https://www.owner.com/blog/loyalty-program-tactics-that-work": { text: articleHtml() },
      "https://www.owner.com/blog/email-capture-at-the-table": { text: articleHtml() },
    }, hits)
    await fetchSourceItems(scrapeSource({ fetchStrategy: "scrape-browser-headers" }), http)
    // every request carried the browser user-agent.
    expect(hits.length).toBeGreaterThan(1)
    expect(hits.every((h) => h.init?.headers?.["user-agent"]?.includes("Mozilla/5.0"))).toBe(true)
  })
})

// ── runIngestion — the upsert must use the FULL dedupe tuple AND surface a write error ─────────────
// This is the regression guard for the CONFIRMED prod bug: the upsert targeted a PARTIAL index (42P10)
// and the error was SWALLOWED (`if (!upErr) rowsWritten += …`), so the run reported success while
// writing 0 rows. These tests pin (1) the conflict target = the new non-partial index tuple, and (2)
// a write error is SURFACED in result.writeErrors with rowsWritten NOT incremented.

/** A passing distill verdict (≥2 tier-1 sources corroborate the same title → an `active` row). */
function distillTransport(): Transport {
  return async () =>
    ({
      title: "Hot honey demand",
      snippet: "Per the source, hot honey is a durable upsell; feature it on a sweet-heat item.",
      confidence: 90,
      attributable: true,
      note: "durable, generalizable",
    }) as unknown
}

/** A canned feed whose body is long enough to distill directly (no link follow). */
function ingestFeed(): string {
  const body = "Per the source, " + "durable hot honey operator tactic prose ".repeat(20) // > 600 chars
  return `<rss><channel>
    <item><title>Hot honey demand</title><content:encoded><![CDATA[${body}]]></content:encoded><link>https://src1.example.com/post</link></item>
  </channel></rss>`
}

/** Two tier-1 sources (same skill) so corroborate() produces a writable row; HttpFetch serves the feed. */
function ingestHttp(): HttpFetch {
  const feed = ingestFeed()
  return async () => ({ ok: true, status: 200, text: async () => feed })
}

/** A loose IngestStore stub: serves two enabled tier-1 sources, captures the upsert payload + the
 *  onConflict it was called with, and lets the test force the upsert to return an error OR throw. */
function ingestStore(opts: { upsertError?: string; upsertThrows?: string } = {}) {
  const captured: { payload: Record<string, unknown>[] | null; onConflict: string | null } = {
    payload: null,
    onConflict: null,
  }
  const sources = [
    { id: "src-1", skill_ids: ["food-pairing"], name: "Tier1 A", vertical: "culinary", url: "https://a.example.com/feed/", fetch_strategy: "rss", auth_kind: "none", trust_tier: 1, enabled: true },
    { id: "src-2", skill_ids: ["food-pairing"], name: "Tier1 B", vertical: "culinary", url: "https://b.example.com/feed/", fetch_strategy: "rss", auth_kind: "none", trust_tier: 1, enabled: true },
  ]
  const store: IngestStore = {
    from() {
      return {
        select() {
          return {
            eq: async () => ({ data: sources, error: null }),
          }
        },
        upsert: async (rows: Record<string, unknown>[], o: { onConflict: string }) => {
          captured.payload = rows
          captured.onConflict = o.onConflict
          if (opts.upsertThrows) throw new Error(opts.upsertThrows)
          return { error: opts.upsertError ? { message: opts.upsertError } : null }
        },
        update() {
          return { eq: async () => ({ data: null, error: null }) }
        },
      }
    },
  }
  return { store, captured }
}

describe("runIngestion — full dedupe tuple + write errors are SURFACED (the prod-bug regression guard)", () => {
  it("upserts skill_knowledge against the FULL non-partial dedupe tuple (scope,scope_id included)", async () => {
    const { store, captured } = ingestStore()
    const result = await runIngestion({ store, http: ingestHttp(), transport: distillTransport() })
    expect(captured.onConflict).toBe("skill_id,scope,scope_id,learning_kind,title")
    // every global payload row sets scope_id: null EXPLICITLY (NOT omitted) so NULLS NOT DISTINCT dedups.
    expect(captured.payload!.length).toBeGreaterThan(0)
    for (const row of captured.payload!) {
      expect(row.scope).toBe("global")
      expect(row.scope_id).toBeNull()
      expect("scope_id" in row).toBe(true)
    }
    expect(result.rowsWritten).toBe(captured.payload!.length)
    expect(result.writeErrors).toEqual([])
  })

  it("SURFACES an upsert error (42P10) in result.writeErrors and does NOT increment rowsWritten", async () => {
    const { store } = ingestStore({ upsertError: "no unique or exclusion constraint matching the ON CONFLICT specification" })
    const result = await runIngestion({ store, http: ingestHttp(), transport: distillTransport() })
    // The run still succeeds (fail-soft, no throw) and reports distilled work...
    expect(result.distilledKept).toBeGreaterThan(0)
    // ...but the write failure can NEVER be invisible again: it's in writeErrors + rowsWritten stays 0.
    expect(result.writeErrors.length).toBeGreaterThan(0)
    expect(result.writeErrors[0].error).toContain("ON CONFLICT")
    expect(result.rowsWritten).toBe(0)
  })

  it("SURFACES a THROWN upsert error (transport timeout) in writeErrors without aborting the run", async () => {
    const { store } = ingestStore({ upsertThrows: "connection reset by peer" })
    const result = await runIngestion({ store, http: ingestHttp(), transport: distillTransport() })
    // Work done before the throw is still reported (the run never aborts)...
    expect(result.distilledKept).toBeGreaterThan(0)
    // ...and the thrown error is surfaced (fail-soft, no uncaught exception) with rowsWritten left at 0.
    expect(result.writeErrors.length).toBeGreaterThan(0)
    expect(result.writeErrors[0].error).toContain("connection reset")
    expect(result.rowsWritten).toBe(0)
  })
})

describe("fetchSourceItems — bounded article fan-out (concurrency still holds)", () => {
  it("never opens more than ARTICLE_FETCH_CONCURRENCY article fetches at once", async () => {
    // 8 article links; assert in-flight article fetches never exceed the cap.
    const linkTags = Array.from({ length: 8 }, (_, i) => `<a href="/blog/durable-operator-tactic-${i}">a${i}</a>`).join("")
    const index = `<main>${linkTags}</main>`
    const routes: Record<string, { text: string }> = { "https://www.owner.com/blog": { text: index } }
    for (let i = 0; i < 8; i++) routes[`https://www.owner.com/blog/durable-operator-tactic-${i}`] = { text: articleHtml({ sentence: `Tactic ${i}: a durable operator move that compounds over time for an independent.` }) }

    let inFlight = 0
    let maxInFlight = 0
    const http: HttpFetch = async (url) => {
      const isArticle = url.includes("/durable-operator-tactic-")
      if (isArticle) {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
      }
      const r = routes[url]
      return { ok: !!r, status: r ? 200 : 404, text: async () => r?.text ?? "" }
    }
    const items = await fetchSourceItems(scrapeSource(), http)
    // capped at SCRAPE_ARTICLE_LINKS (5) links, and the fan-out honored the concurrency cap.
    expect(items.length).toBe(5)
    expect(maxInFlight).toBeLessThanOrEqual(ARTICLE_FETCH_CONCURRENCY)
    expect(maxInFlight).toBeGreaterThan(0)
  })
})
