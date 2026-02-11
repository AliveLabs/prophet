// ---------------------------------------------------------------------------
// Shared DataForSEO HTTP client – auth + request helper
// ---------------------------------------------------------------------------

export const DATAFORSEO_BASE_URL = "https://api.dataforseo.com"

export function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) {
    throw new Error("DATAFORSEO credentials are not configured")
  }
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`
}

export async function postDataForSEO<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${DATAFORSEO_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`DataForSEO error: ${response.status} ${text}`)
  }

  return (await response.json()) as T
}

// ---------------------------------------------------------------------------
// Standard DataForSEO response shape (used by most endpoints)
// ---------------------------------------------------------------------------

export type DataForSEOTaskResponse<T = unknown> = {
  tasks?: Array<{
    id?: string
    status_code?: number
    status_message?: string
    result?: T[]
  }>
}

/**
 * Extract the first result from a standard DataForSEO task response.
 * Throws if the task status indicates an error.
 */
export function extractFirstResult<T>(
  data: DataForSEOTaskResponse<T>,
  label: string
): T | null {
  const task = data.tasks?.[0]
  if (task?.status_code && task.status_code !== 20000) {
    throw new Error(
      `DataForSEO ${label} error: ${task.status_code} ${task.status_message ?? ""}`
    )
  }
  return task?.result?.[0] ?? null
}
