import { redirect } from "next/navigation"

// The all-insights view moved to /insights (2026-08-13 consolidation): one canonical
// page carrying both sections plus the filters. The path stays as a redirect so
// bookmarks and old links keep working.
export default function AllInsightsPage() {
  redirect("/insights")
}
