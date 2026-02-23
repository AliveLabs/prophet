// ---------------------------------------------------------------------------
// GET /api/jobs/active – returns running + recently finished jobs for the org
// Query params:
//   ?include_recent=true  – also return jobs completed in the last 2 min
// ---------------------------------------------------------------------------

import { getJobAuthContext } from "@/lib/jobs/auth"
import { getActiveJobs, getRecentJobs } from "@/lib/jobs/manager"

export const dynamic = "force-dynamic"

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
}

export async function GET(req: Request) {
  const auth = await getJobAuthContext()
  if (!auth) {
    return Response.json([], { headers: NO_CACHE_HEADERS })
  }

  const url = new URL(req.url)
  const includeRecent = url.searchParams.get("include_recent") === "true"

  try {
    const jobs = includeRecent
      ? await getRecentJobs(auth.organizationId)
      : await getActiveJobs(auth.organizationId)
    return Response.json(jobs, { headers: NO_CACHE_HEADERS })
  } catch {
    return Response.json([], { headers: NO_CACHE_HEADERS })
  }
}
