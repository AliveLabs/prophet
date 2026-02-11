"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Suspense, useCallback, type ReactNode } from "react"

// ---------------------------------------------------------------------------
// AutoFilterForm – replaces <form method="get"> with auto-navigating selects
// ---------------------------------------------------------------------------

type FilterConfig = {
  name: string
  defaultValue: string
  options: Array<{ value: string; label: string }>
}

type Props = {
  filters: FilterConfig[]
  /** Extra buttons or elements rendered at the end */
  children?: ReactNode
}

function AutoFilterFormInner({ filters, children }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleChange = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      if (value) {
        params.set(name, value)
      } else {
        params.delete(name)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <select
          key={f.name}
          value={searchParams?.get(f.name) ?? f.defaultValue}
          onChange={(e) => handleChange(f.name, e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {children}
    </div>
  )
}

export default function AutoFilterForm(props: Props) {
  return (
    <Suspense fallback={<div className="mt-4 h-8" />}>
      <AutoFilterFormInner {...props} />
    </Suspense>
  )
}
