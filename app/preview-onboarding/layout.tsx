// DEV/REVIEW-ONLY onboarding flow (no auth, prod-guarded, no app shell).
import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import "./onboarding.css"

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound()
  return <>{children}</>
}
