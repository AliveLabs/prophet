"use client"

import { useEffect, type ReactNode } from "react"

const DEFAULT_BRAND = "ticket"

export function BrandProvider({
  brand,
  children,
}: {
  brand?: string
  children: ReactNode
}) {
  useEffect(() => {
    const html = document.documentElement
    html.setAttribute("data-brand", brand ?? DEFAULT_BRAND)
    return () => {
      html.setAttribute("data-brand", DEFAULT_BRAND)
    }
  }, [brand])

  return <>{children}</>
}
