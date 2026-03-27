import { Suspense, type ReactNode } from "react"

function AuthSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="h-6 w-16 animate-pulse rounded bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  )
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      {children}
    </Suspense>
  )
}
