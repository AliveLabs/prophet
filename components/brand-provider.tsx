"use client"

import { useEffect, type ReactNode } from "react"

export function BrandProvider({
  brand,
  children,
}: {
  brand?: string
  children: ReactNode
}) {
  useEffect(() => {
    const html = document.documentElement
    if (brand) {
      html.setAttribute("data-brand", brand)
    } else {
      html.removeAttribute("data-brand")
    }
    return () => {
      html.removeAttribute("data-brand")
    }
  }, [brand])

  return <>{children}</>
}
