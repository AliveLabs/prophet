// ---------------------------------------------------------------------------
// Shared DataForSEO HTTP client – auth + request helper
// ---------------------------------------------------------------------------

import { fetchWithRetry } from "@/lib/http/fetch-with-retry"

export const DATAFORSEO_BASE_URL = "https://api.dataforseo.com"

/**
 * Typed DataForSEO failure so callers can tell a vendor outage (esp. a 402 "out of credits")
 * apart from a code bug or a timeout — mirrors lib/providers/data365/client.ts:Data365Error.
 * Before this, a 402 was a plain Error with the status only inside the message string, so the
 * job pipeline laundered a fleet-wide credit outage into a generic "partial"/"failed" run.
 */
export class DataForSEOError extends Error {
  readonly provider = "dataforseo" as const
  constructor(
    message: string,
    /** HTTP status (402 = account out of credits). */
    public readonly httpStatus?: number,
    /** DataForSEO task-level status_code (20000 = ok; 402xx = payment family). */
    public readonly taskStatusCode?: number,
    public readonly body?: string,
  ) {
    super(message)
    this.name = "DataForSEOError"
  }

  /** True when the failure is "account out of credits" — HTTP 402 or a 402xx task code.
   *  This is the actionable signal (refill needed), used to drive the ops alert. */
  get isPaymentRequired(): boolean {
    if (this.httpStatus === 402) return true
    return this.taskStatusCode != null && Math.floor(this.taskStatusCode / 100) === 402
  }
}

export function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) {
    throw new Error("DATAFORSEO credentials are not configured")
  }
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`
}

export async function postDataForSEO<T>(path: string, body: unknown): Promise<T> {
  const response = await fetchWithRetry(
    `${DATAFORSEO_BASE_URL}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs: 60_000,
      // Retry transient server/rate errors; NEVER retry a 402 (out of credits) — re-POSTing a task
      // wastes another charge. The !response.ok check below still throws DataForSEOError on any non-OK.
      shouldRetryResponse: (r) => r.status === 429 || r.status >= 500,
      label: "dataforseo",
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new DataForSEOError(`DataForSEO error: ${response.status} ${text}`, response.status, undefined, text)
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
    throw new DataForSEOError(
      `DataForSEO ${label} error: ${task.status_code} ${task.status_message ?? ""}`,
      undefined,
      task.status_code,
    )
  }
  return task?.result?.[0] ?? null
}
