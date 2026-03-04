import { createHash } from "crypto"

const GEMINI_VISION_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

function getPlacesKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not configured")
  return key
}

function getGeminiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) throw new Error("GOOGLE_AI_API_KEY is not configured")
  return key
}

export type PhotoReference = {
  name: string
  widthPx: number
  heightPx: number
  authorAttributions: Array<{ displayName?: string; uri?: string; photoUri?: string }>
}

export type FetchedPhoto = {
  reference: PhotoReference
  buffer: Buffer
  hash: string
  mimeType: string
}

export type PhotoCategory =
  | "food_dish" | "menu_board" | "interior" | "exterior"
  | "patio_outdoor" | "bar_drinks" | "staff_team" | "event_promotion"
  | "signage" | "renovation" | "seasonal_decor" | "customer_atmosphere" | "other"

export type PhotoAnalysis = {
  category: PhotoCategory
  subcategory: string
  tags: string[]
  extracted_text: string
  promotional_content: boolean
  promotional_details: string
  quality_signals: {
    lighting: "professional" | "amateur" | "unknown"
    staging: "styled" | "candid" | "unknown"
  }
  confidence: number
  notable_changes: string
}

export type PhotoDiffResult = {
  added: Array<{ hash: string; analysis: PhotoAnalysis | null }>
  removed: string[]
  categoryShift: boolean
  categoryDelta: Record<string, number>
  newPromotions: Array<{ hash: string; details: string }>
  ocrChanges: Array<{ hash: string; text: string }>
}

// Stage 1: Fetch photo references from Google Places API (New)
export async function fetchPhotoReferences(placeId: string): Promise<PhotoReference[]> {
  const url = `https://places.googleapis.com/v1/places/${placeId}`
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": getPlacesKey(),
      "X-Goog-FieldMask": "id,displayName,photos",
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Places photo refs error ${res.status}: ${text}`)
  }

  const data = await res.json()
  const photos: PhotoReference[] = (data.photos ?? []).slice(0, 10).map(
    (p: { name: string; widthPx?: number; heightPx?: number; authorAttributions?: unknown[] }) => ({
      name: p.name,
      widthPx: p.widthPx ?? 0,
      heightPx: p.heightPx ?? 0,
      authorAttributions: (p.authorAttributions ?? []) as PhotoReference["authorAttributions"],
    })
  )

  return photos
}

// Stage 1: Download a single photo by its resource name
export async function downloadPhoto(photoName: string): Promise<FetchedPhoto & { reference: PhotoReference }> {
  const mediaUrl =
    `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&key=${getPlacesKey()}&skipHttpRedirect=true`

  const metaRes = await fetch(mediaUrl)
  if (!metaRes.ok) {
    throw new Error(`Photo media meta error ${metaRes.status}`)
  }
  const meta = await metaRes.json()
  const imageUrl: string = meta.photoUri ?? meta.uri ?? ""

  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) {
    throw new Error(`Photo download error ${imgRes.status}`)
  }

  const arrayBuf = await imgRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuf)
  const hash = createHash("sha256").update(buffer).digest("hex")
  const mimeType = imgRes.headers.get("content-type") ?? "image/jpeg"

  return {
    reference: {
      name: photoName,
      widthPx: 0,
      heightPx: 0,
      authorAttributions: [],
    },
    buffer,
    hash,
    mimeType,
  }
}

// Stage 1: Fetch all photos for a place with rate limiting
export async function fetchAllPhotos(
  placeId: string,
  existingHashes: Set<string>
): Promise<FetchedPhoto[]> {
  const refs = await fetchPhotoReferences(placeId)
  const photos: FetchedPhoto[] = []

  for (const ref of refs) {
    try {
      await sleep(200)
      const photo = await downloadPhoto(ref.name)
      photo.reference = ref

      if (!existingHashes.has(photo.hash)) {
        photos.push(photo)
      }
    } catch (err) {
      console.warn(`[photos] Failed to download ${ref.name}:`, err)
    }
  }

  return photos
}

// Stage 2: Analyze a photo with Gemini Vision
export async function analyzePhoto(imageBuffer: Buffer, mimeType: string): Promise<PhotoAnalysis> {
  const base64 = imageBuffer.toString("base64")

  const prompt = `You are a competitive intelligence photo analyst for local restaurants.
Analyze this Google Places photo and return ONLY valid JSON with these fields:
- category: one of [food_dish, menu_board, interior, exterior, patio_outdoor, bar_drinks, staff_team, event_promotion, signage, renovation, seasonal_decor, customer_atmosphere, other]
- subcategory: more specific label (e.g. "pizza", "cocktail menu", "holiday decoration")
- tags: array of 3-8 descriptive tags
- extracted_text: any readable text in the image (OCR). Return empty string if none.
- promotional_content: boolean, true if the image contains promotional material, specials, or limited-time offers
- promotional_details: if promotional_content is true, describe the promotion. Empty string otherwise.
- quality_signals: object with { lighting: "professional"|"amateur"|"unknown", staging: "styled"|"candid"|"unknown" }
- confidence: number 0.0-1.0 for overall classification confidence
- notable_changes: describe anything that suggests a recent renovation, new menu item, or operational change. Empty string if nothing notable.`

  const res = await fetch(`${GEMINI_VISION_URL}?key=${getGeminiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
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
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}"

  try {
    const parsed = JSON.parse(rawText) as PhotoAnalysis
    return {
      category: parsed.category ?? "other",
      subcategory: parsed.subcategory ?? "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      extracted_text: parsed.extracted_text ?? "",
      promotional_content: parsed.promotional_content ?? false,
      promotional_details: parsed.promotional_details ?? "",
      quality_signals: parsed.quality_signals ?? { lighting: "unknown", staging: "unknown" },
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      notable_changes: parsed.notable_changes ?? "",
    }
  } catch {
    return {
      category: "other",
      subcategory: "",
      tags: [],
      extracted_text: "",
      promotional_content: false,
      promotional_details: "",
      quality_signals: { lighting: "unknown", staging: "unknown" },
      confidence: 0.3,
      notable_changes: "",
    }
  }
}

// Stage 3: Diff current vs previous photo sets
export function diffPhotos(
  currentPhotos: Array<{ hash: string; analysis: PhotoAnalysis | null }>,
  previousHashes: Set<string>,
  previousCategoryDist: Record<string, number>
): PhotoDiffResult {
  const added = currentPhotos.filter(p => !previousHashes.has(p.hash))
  const currentHashSet = new Set(currentPhotos.map(p => p.hash))
  const removed = [...previousHashes].filter(h => !currentHashSet.has(h))

  const currentCategoryDist: Record<string, number> = {}
  for (const p of currentPhotos) {
    const cat = p.analysis?.category ?? "other"
    currentCategoryDist[cat] = (currentCategoryDist[cat] ?? 0) + 1
  }

  const categoryDelta: Record<string, number> = {}
  const allCategories = new Set([
    ...Object.keys(currentCategoryDist),
    ...Object.keys(previousCategoryDist),
  ])
  let totalShift = 0
  for (const cat of allCategories) {
    const curr = (currentCategoryDist[cat] ?? 0) / (currentPhotos.length || 1)
    const prev = (previousCategoryDist[cat] ?? 0) / ([...previousHashes].length || 1)
    categoryDelta[cat] = +(curr - prev).toFixed(2)
    totalShift += Math.abs(curr - prev)
  }

  const newPromotions = added
    .filter(p => p.analysis?.promotional_content)
    .map(p => ({ hash: p.hash, details: p.analysis?.promotional_details ?? "" }))

  const ocrChanges = added
    .filter(p => p.analysis?.extracted_text)
    .map(p => ({ hash: p.hash, text: p.analysis?.extracted_text ?? "" }))

  return {
    added,
    removed,
    categoryShift: totalShift > 0.2,
    categoryDelta,
    newPromotions,
    ocrChanges,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
