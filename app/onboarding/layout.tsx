import { Suspense, type ReactNode } from "react"
import "./onboarding.css"

// The onboarding surface carries its own pearlescent token surface (.ob).
// The Suspense fallback matches it so the first paint never flashes a
// non-token background.
function OnboardingSkeleton() {
  return (
    <div className="ob">
      <div className="ob-canvas" aria-hidden="true" />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div className="ob-sweep" style={{ width: 180 }} />
      </div>
    </div>
  )
}

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <Suspense fallback={<OnboardingSkeleton />}>
      {children}
    </Suspense>
  )
}
