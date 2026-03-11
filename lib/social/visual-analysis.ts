// ---------------------------------------------------------------------------
// Social Post Visual Analysis (Gemini Vision)
//
// Analyzes social media post images using Gemini Vision to extract:
// - Content category & subcategory
// - Food presentation quality
// - Visual quality (lighting, composition, editing)
// - Brand signals (logo, colors, style consistency)
// - Atmosphere signals (crowd, energy, time of day)
// - Promotional content detection
// - OCR text extraction
//
// Uses the same Gemini Vision API as lib/providers/photos.ts but with a
// social-media-specific prompt.
// ---------------------------------------------------------------------------

import type {
  SocialPostAnalysis,
  EntityVisualProfile,
  NormalizedSocialPost,
  SocialPlatform,
} from "./types"

const GEMINI_VISION_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

const RATE_LIMIT_MS = 150

function getGeminiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) throw new Error("GOOGLE_AI_API_KEY is not configured")
  return key
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Social-media-specific Gemini Vision prompt
// ---------------------------------------------------------------------------

function buildSocialVisionPrompt(postText: string | null, platform: string): string {
  const captionContext = postText
    ? `\nThe post caption is: "${postText.slice(0, 500)}"`
    : "\nNo caption is available for this post."

  return `You are a competitive intelligence analyst specializing in restaurant and local business social media.
Analyze this ${platform} post image and return ONLY valid JSON with these fields:

- contentCategory: one of ["food_dish", "drink_cocktail", "interior_ambiance", "exterior_facade", "patio_outdoor", "event_live", "staff_team", "behind_the_scenes", "customer_ugc", "menu_promo", "seasonal_holiday", "repost_meme", "product_merchandise", "community_collab", "other"]
- subcategory: more specific label (e.g. "pizza close-up", "craft cocktail", "holiday brunch table")
- tags: array of 3-8 descriptive tags
- extractedText: any readable text in the image (OCR). Empty string if none.
- foodPresentation: object with:
  - platingQuality: "high" | "medium" | "low" | "n/a"
  - portionAppeal: "generous" | "standard" | "small" | "n/a"
  - colorVibrancy: "vibrant" | "muted" | "n/a"
- visualQuality: object with:
  - lighting: "professional" | "natural_good" | "amateur" | "poor"
  - composition: "professional" | "decent" | "casual" | "poor"
  - editing: "polished" | "filtered" | "minimal" | "none"
- brandSignals: object with:
  - logoVisible: boolean
  - brandColorsPresent: boolean
  - visualStyleConsistency: "on_brand" | "neutral" | "off_brand"
- atmosphereSignals: object with:
  - crowdLevel: "packed" | "busy" | "moderate" | "empty" | "n/a"
  - energy: "high" | "relaxed" | "intimate" | "n/a"
  - timeOfDay: "day" | "evening" | "night" | "unknown"
- promotionalContent: boolean (true if the image advertises a deal, special, discount, event, or limited-time offer)
- promotionalDetails: describe the promotion if detected, empty string otherwise
- confidence: number 0.0-1.0 for overall classification confidence
${captionContext}`
}

// ---------------------------------------------------------------------------
// Analyze a single social post image via Gemini Vision
// ---------------------------------------------------------------------------

export async function analyzeSocialPostImage(
  imageBuffer: Buffer,
  mimeType: string,
  postText: string | null,
  platform: string
): Promise<SocialPostAnalysis> {
  const base64 = imageBuffer.toString("base64")
  const prompt = buildSocialVisionPrompt(postText, platform)

  const res = await fetch(`${GEMINI_VISION_URL}?key=${getGeminiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini Vision error ${res.status}: ${text}`)
  }

  const data = await res.json()
  const rawText: string =
    data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}"

  try {
    const p = JSON.parse(rawText) as Partial<SocialPostAnalysis>
    return sanitizeAnalysis(p)
  } catch {
    return defaultAnalysis()
  }
}

// ---------------------------------------------------------------------------
// Analyze posts with images for a set of entities.
// Returns a Map<postId, SocialPostAnalysis>.
// Skips posts that already have a visualAnalysis or lack a Supabase Storage URL.
// Limits to top MAX_POSTS_PER_BATCH by engagement to keep runtime reasonable.
// Uses limited concurrency (CONCURRENCY parallel Gemini calls).
// ---------------------------------------------------------------------------

const MAX_POSTS_PER_BATCH = 10
const CONCURRENCY = 3
const DOWNLOAD_TIMEOUT_MS = 8_000

export async function analyzePostImages(
  posts: NormalizedSocialPost[],
): Promise<Map<string, SocialPostAnalysis>> {
  const results = new Map<string, SocialPostAnalysis>()

  // Carry forward existing analyses
  for (const post of posts) {
    if (post.visualAnalysis) {
      results.set(post.platformPostId, post.visualAnalysis)
    }
  }

  // Filter to posts needing analysis, sorted by engagement (highest first)
  const needsAnalysis = posts
    .filter(
      (p) =>
        !p.visualAnalysis &&
        p.mediaUrl &&
        p.mediaUrl.includes("supabase")
    )
    .sort(
      (a, b) =>
        b.likesCount + b.commentsCount + b.sharesCount -
        (a.likesCount + a.commentsCount + a.sharesCount)
    )
    .slice(0, MAX_POSTS_PER_BATCH)

  if (needsAnalysis.length === 0) return results

  console.log(
    `[SocialVision] Analyzing ${needsAnalysis.length} posts (${posts.length} total, ${results.size} already analyzed)`
  )

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < needsAnalysis.length; i += CONCURRENCY) {
    const chunk = needsAnalysis.slice(i, i + CONCURRENCY)

    const chunkResults = await Promise.allSettled(
      chunk.map((post) => analyzeSinglePost(post))
    )

    for (let j = 0; j < chunkResults.length; j++) {
      const r = chunkResults[j]
      if (r.status === "fulfilled" && r.value) {
        results.set(chunk[j].platformPostId, r.value)
      }
    }

    if (i + CONCURRENCY < needsAnalysis.length) {
      await sleep(RATE_LIMIT_MS)
    }
  }

  console.log(
    `[SocialVision] Done: ${results.size} total analyses (${results.size - posts.filter((p) => p.visualAnalysis).length} new)`
  )

  return results
}

async function analyzeSinglePost(
  post: NormalizedSocialPost
): Promise<SocialPostAnalysis | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

    const imgRes = await fetch(post.mediaUrl!, { signal: controller.signal })
    clearTimeout(timer)

    if (!imgRes.ok) return null

    const arrayBuf = await imgRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const mimeType = imgRes.headers.get("content-type") ?? "image/jpeg"

    if (buffer.length < 1000) return null

    return await analyzeSocialPostImage(buffer, mimeType, post.text, post.platform)
  } catch (err) {
    console.warn(
      `[SocialVision] Failed to analyze post ${post.platformPostId}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}

// ---------------------------------------------------------------------------
// Aggregate visual analyses into an EntityVisualProfile
// ---------------------------------------------------------------------------

const QUALITY_SCORES: Record<string, number> = {
  professional: 100,
  natural_good: 75,
  polished: 100,
  decent: 60,
  filtered: 70,
  amateur: 35,
  casual: 40,
  minimal: 40,
  poor: 10,
  none: 20,
}

const FOOD_SCORES: Record<string, number> = {
  high: 100,
  medium: 60,
  low: 25,
  "n/a": 0,
}

const CROWD_SCORES: Record<string, number> = {
  packed: 100,
  busy: 80,
  moderate: 50,
  empty: 10,
  "n/a": 0,
}

export function aggregateVisualMetrics(
  entityType: "location" | "competitor",
  entityId: string,
  entityName: string,
  platform: SocialPlatform,
  posts: NormalizedSocialPost[],
  analysisMap: Map<string, SocialPostAnalysis>
): EntityVisualProfile | null {
  const analyzed: Array<{
    postId: string
    analysis: SocialPostAnalysis
    engagement: number
  }> = []

  for (const post of posts) {
    const analysis = analysisMap.get(post.platformPostId)
    if (!analysis) continue
    analyzed.push({
      postId: post.platformPostId,
      analysis,
      engagement: post.likesCount + post.commentsCount + post.sharesCount,
    })
  }

  if (analyzed.length === 0) return null

  const total = analyzed.length

  // Content mix: % of posts per category
  const categoryCounts: Record<string, number> = {}
  for (const a of analyzed) {
    const cat = a.analysis.contentCategory
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1
  }
  const contentMix: Record<string, number> = {}
  for (const [cat, count] of Object.entries(categoryCounts)) {
    contentMix[cat] = Math.round((count / total) * 100)
  }

  // Avg visual quality score (0-100)
  let qualitySum = 0
  for (const a of analyzed) {
    const vq = a.analysis.visualQuality
    const lightScore = QUALITY_SCORES[vq.lighting] ?? 50
    const compScore = QUALITY_SCORES[vq.composition] ?? 50
    const editScore = QUALITY_SCORES[vq.editing] ?? 50
    qualitySum += (lightScore + compScore + editScore) / 3
  }
  const avgVisualQualityScore = Math.round(qualitySum / total)

  // Professional content %
  const professionalCount = analyzed.filter((a) => {
    const vq = a.analysis.visualQuality
    return vq.lighting === "professional" || vq.composition === "professional"
  }).length
  const professionalContentPct = Math.round((professionalCount / total) * 100)

  // Food presentation score
  const foodPosts = analyzed.filter(
    (a) => a.analysis.foodPresentation.platingQuality !== "n/a"
  )
  let foodPresentationScore = 0
  if (foodPosts.length > 0) {
    let foodSum = 0
    for (const a of foodPosts) {
      foodSum += FOOD_SCORES[a.analysis.foodPresentation.platingQuality] ?? 0
    }
    foodPresentationScore = Math.round(foodSum / foodPosts.length)
  }

  // Brand consistency score
  const onBrandCount = analyzed.filter(
    (a) => a.analysis.brandSignals.visualStyleConsistency === "on_brand"
  ).length
  const offBrandCount = analyzed.filter(
    (a) => a.analysis.brandSignals.visualStyleConsistency === "off_brand"
  ).length
  const brandConsistencyScore = Math.round(
    ((onBrandCount * 100 + (total - onBrandCount - offBrandCount) * 50) / total)
  )

  // Promotional content %
  const promoCount = analyzed.filter((a) => a.analysis.promotionalContent).length
  const promotionalContentPct = Math.round((promoCount / total) * 100)

  // Crowd signal score
  const crowdPosts = analyzed.filter(
    (a) => a.analysis.atmosphereSignals.crowdLevel !== "n/a"
  )
  let crowdSignalScore = 0
  if (crowdPosts.length > 0) {
    let crowdSum = 0
    for (const a of crowdPosts) {
      crowdSum += CROWD_SCORES[a.analysis.atmosphereSignals.crowdLevel] ?? 0
    }
    crowdSignalScore = Math.round(crowdSum / crowdPosts.length)
  }

  return {
    entityType,
    entityId,
    entityName,
    platform,
    contentMix,
    avgVisualQualityScore,
    professionalContentPct,
    foodPresentationScore,
    brandConsistencyScore,
    promotionalContentPct,
    crowdSignalScore,
    postAnalyses: analyzed,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  "food_dish", "drink_cocktail", "interior_ambiance", "exterior_facade",
  "patio_outdoor", "event_live", "staff_team", "behind_the_scenes",
  "customer_ugc", "menu_promo", "seasonal_holiday", "repost_meme",
  "product_merchandise", "community_collab", "other",
])

function sanitizeAnalysis(p: Partial<SocialPostAnalysis>): SocialPostAnalysis {
  return {
    contentCategory: VALID_CATEGORIES.has(p.contentCategory as string)
      ? (p.contentCategory as SocialPostAnalysis["contentCategory"])
      : "other",
    subcategory: typeof p.subcategory === "string" ? p.subcategory : "",
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    extractedText: typeof p.extractedText === "string" ? p.extractedText : "",
    foodPresentation: {
      platingQuality: validateEnum(p.foodPresentation?.platingQuality, ["high", "medium", "low", "n/a"], "n/a"),
      portionAppeal: validateEnum(p.foodPresentation?.portionAppeal, ["generous", "standard", "small", "n/a"], "n/a"),
      colorVibrancy: validateEnum(p.foodPresentation?.colorVibrancy, ["vibrant", "muted", "n/a"], "n/a"),
    },
    visualQuality: {
      lighting: validateEnum(p.visualQuality?.lighting, ["professional", "natural_good", "amateur", "poor"], "amateur"),
      composition: validateEnum(p.visualQuality?.composition, ["professional", "decent", "casual", "poor"], "casual"),
      editing: validateEnum(p.visualQuality?.editing, ["polished", "filtered", "minimal", "none"], "minimal"),
    },
    brandSignals: {
      logoVisible: p.brandSignals?.logoVisible === true,
      brandColorsPresent: p.brandSignals?.brandColorsPresent === true,
      visualStyleConsistency: validateEnum(
        p.brandSignals?.visualStyleConsistency,
        ["on_brand", "neutral", "off_brand"],
        "neutral"
      ),
    },
    atmosphereSignals: {
      crowdLevel: validateEnum(p.atmosphereSignals?.crowdLevel, ["packed", "busy", "moderate", "empty", "n/a"], "n/a"),
      energy: validateEnum(p.atmosphereSignals?.energy, ["high", "relaxed", "intimate", "n/a"], "n/a"),
      timeOfDay: validateEnum(p.atmosphereSignals?.timeOfDay, ["day", "evening", "night", "unknown"], "unknown"),
    },
    promotionalContent: p.promotionalContent === true,
    promotionalDetails: typeof p.promotionalDetails === "string" ? p.promotionalDetails : "",
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
  }
}

function defaultAnalysis(): SocialPostAnalysis {
  return {
    contentCategory: "other",
    subcategory: "",
    tags: [],
    extractedText: "",
    foodPresentation: { platingQuality: "n/a", portionAppeal: "n/a", colorVibrancy: "n/a" },
    visualQuality: { lighting: "amateur", composition: "casual", editing: "minimal" },
    brandSignals: { logoVisible: false, brandColorsPresent: false, visualStyleConsistency: "neutral" },
    atmosphereSignals: { crowdLevel: "n/a", energy: "n/a", timeOfDay: "unknown" },
    promotionalContent: false,
    promotionalDetails: "",
    confidence: 0.3,
  }
}

function validateEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}
