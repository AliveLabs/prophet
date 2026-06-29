import { Suspense, type ReactNode } from "react"
import "@/app/onboarding/onboarding.css"

// The wizard carries its own pearlescent token surface (.ob). The Suspense
// fallback matches it so the first paint never flashes a non-token background.
function NewOrgSkeleton() {
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

export default function NewOrgLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<NewOrgSkeleton />}>
      {children}
    </Suspense>
  )
}
