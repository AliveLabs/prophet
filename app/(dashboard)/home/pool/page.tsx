import { redirect } from "next/navigation"

// The pool page retired 2026-08-13: its uncapped list moved to the all-insights view
// (/insights/all — two sections, unified card, batch reveal). The path stays as a
// redirect so bookmarks and old emails keep working.
export default function InsightPoolPage() {
  redirect("/insights/all")
}
