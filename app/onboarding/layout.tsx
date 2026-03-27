import { Suspense, type ReactNode } from "react"

function OnboardingSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
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
