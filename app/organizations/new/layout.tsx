import { Suspense, type ReactNode } from "react"

function NewOrgSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
