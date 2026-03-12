import type { ReactNode } from "react"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-warm-white text-near-black">{children}</div>
}
