// DEV/REVIEW-ONLY onboarding flow (no auth, prod-guarded, no app shell).
import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import "./onboarding.css"

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  // PRODUCTION deploy only — VERCEL_ENV, not NODE_ENV (which is "production" on every
  // Vercel build incl. previews; this route must stay visible on previews for review).
  if (process.env.VERCEL_ENV === "production") notFound()
  return <>{children}</>
}
