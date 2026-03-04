// ---------------------------------------------------------------------------
// Data365 API Client
//
// Implements the async POST/GET/GET pattern per Data365 OpenAPI spec:
//   1. POST  .../update  → initiate data collection
//   2. GET   .../update  → poll until status is "finished"
//   3. GET   .../         → retrieve collected data
//
// Platform-specific path structures (from the OpenAPI spec):
//
//   Profile:  /{platform}/profile/{profile_id}/update
//   Posts:    /{platform}/profile/{profile_id}/{section}/posts
//
//   TikTok search:   /tiktok/search/profile/update  → .../profile/items
//   Facebook search:  /facebook/search/{query}/profiles/{type}/update
//   Instagram search: /instagram/search/profiles/update (keywords param)
// ---------------------------------------------------------------------------

export type Data365Platform = "instagram" | "facebook" | "tiktok"

export type Data365UpdateStatus =
  | "created"
  | "pending"
  | "in_progress"
  | "finished"
  | "fail"
  | "canceled"

type UpdateStatusResponse = {
  data?: { status: Data365UpdateStatus; error_message?: string }
  status: string
  error?: { code?: string; message?: string }
}

export class Data365Error extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public apiError?: string
  ) {
    super(message)
    this.name = "Data365Error"
  }
}

function getAccessToken(): string {
  const token = process.env.DATA365_ACCESS_TOKEN
  if (!token) throw new Data365Error("DATA365_ACCESS_TOKEN environment variable is not set")
  return token
}

const BASE_URL = "https://api.data365.co/v1.1"

const POLL_INTERVAL_MS = 3_000
const MAX_POLL_ATTEMPTS = 40

async function apiRequest<T>(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const token = getAccessToken()
  const url = new URL(`${BASE_URL}${path}`)
  url.searchParams.set("access_token", token)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url.toString(), { method })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Data365Error(
      `Data365 API error: ${res.status} ${res.statusText}`,
      res.status,
      text
    )
  }

  return res.json() as Promise<T>
}

function extractPollStatus(raw: UpdateStatusResponse): Data365UpdateStatus {
  if (raw.data?.status) return raw.data.status
  if (raw.status === "ok") return "finished"
  if (raw.status === "fail") return "fail"
  return "pending"
}

async function pollUntilDone(
  path: string,
  pollParams?: Record<string, string>,
  label = "unknown"
): Promise<void> {
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS) {
    await sleep(POLL_INTERVAL_MS)
    attempts++

    const raw = await apiRequest<UpdateStatusResponse>("GET", path, pollParams)
    const status = extractPollStatus(raw)

    if (status === "finished") return

    if (status === "fail" || status === "canceled") {
      const msg = raw.data?.error_message ?? raw.error?.message ?? "unknown error"
      throw new Data365Error(`Data365 collection ${status} for ${label}: ${msg}`)
    }
  }

  throw new Data365Error(
    `Data365 polling timed out after ${MAX_POLL_ATTEMPTS} attempts for ${label}`
  )
}

// ---------------------------------------------------------------------------
// Profile: POST → poll → GET
// Path: /{platform}/profile/{profile_id}/update
// ---------------------------------------------------------------------------

export async function fetchProfile<T>(
  platform: Data365Platform,
  profileId: string,
  extraParams?: Record<string, string>
): Promise<T> {
  const basePath = `/${platform}/profile/${encodeURIComponent(profileId)}`
  const postParams = { load_posts: "true", max_posts: "20", ...extraParams }

  await apiRequest<unknown>("POST", `${basePath}/update`, postParams)
  await pollUntilDone(`${basePath}/update`, undefined, `${platform}/${profileId}`)
  try {
    return await apiRequest<T>("GET", basePath, extraParams)
  } catch (err) {
    if (err instanceof Data365Error && err.statusCode === 404) {
      console.warn(`[Data365] Profile not found (404) for ${platform}/${profileId} – may not exist on the platform`)
      return { data: null } as T
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Posts: GET /{platform}/profile/{profile_id}/{section}/posts
// ---------------------------------------------------------------------------

const DEFAULT_POST_SECTION: Record<Data365Platform, string> = {
  instagram: "feed",
  facebook: "feed",
  tiktok: "feed",
}

export async function fetchPosts<T>(
  platform: Data365Platform,
  profileId: string,
  limit = 20,
  extraParams?: Record<string, string>
): Promise<T> {
  const section = DEFAULT_POST_SECTION[platform]
  const postsPath = `/${platform}/profile/${encodeURIComponent(profileId)}/${section}/posts`

  return apiRequest<T>("GET", postsPath, {
    max_page: "1",
    page_size: String(limit),
    order_by: "date_desc",
    ...extraParams,
  })
}

// ---------------------------------------------------------------------------
// Search (kept for reference but NOT used in the social pipeline)
// ---------------------------------------------------------------------------

export async function searchProfiles<T>(
  platform: Data365Platform,
  keywords: string,
  limit = 10
): Promise<T> {
  if (platform === "instagram") {
    const path = "/instagram/search/profiles"
    await apiRequest<unknown>("POST", `${path}/update`, {
      keywords,
      max_page: "1",
      page_size: String(limit),
    })
    await pollUntilDone(`${path}/update`, { keywords }, `instagram/${keywords}`)
    return apiRequest<T>("GET", path, {
      keywords,
      max_page: "1",
      page_size: String(limit),
    })
  }

  if (platform === "tiktok") {
    const path = "/tiktok/search/profile"
    await apiRequest<unknown>("POST", `${path}/update`, {
      keywords,
      max_page: "1",
      page_size: String(limit),
    })
    await pollUntilDone(`${path}/update`, { keywords }, `tiktok/${keywords}`)
    return apiRequest<T>("GET", `${path}/items`, {
      keywords,
      max_page: "1",
      page_size: String(limit),
    })
  }

  if (platform === "facebook") {
    const encodedQuery = encodeURIComponent(keywords)
    const basePath = `/facebook/search/${encodedQuery}/profiles/pages`
    await apiRequest<unknown>("POST", `${basePath}/update`)
    await pollUntilDone(`${basePath}/update`, undefined, `facebook/${keywords}`)
    return apiRequest<T>(`GET`, `${basePath}/profiles`, {
      max_page: "1",
      page_size: String(limit),
    })
  }

  throw new Data365Error(`Profile search is not supported for ${platform}`, 501)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
