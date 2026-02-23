"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Suspense, useCallback } from "react"

type TabConfig = {
  value: string
  label: string
  count: number
  color: string
  activeColor: string
}

type Props = {
  counts: {
    all: number
    competitors: number
    events: number
    seo: number
    content: number
  }
  activeSource: string
}

function InsightTabsInner({ counts }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleClick = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      if (value) {
        params.set("source", value)
      } else {
        params.delete("source")
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const tabs: TabConfig[] = [
    { value: "", label: "All", count: counts.all, color: "text-slate-600", activeColor: "bg-slate-900 text-white" },
    { value: "competitors", label: "Competitors", count: counts.competitors, color: "text-emerald-700", activeColor: "bg-emerald-600 text-white" },
    { value: "events", label: "Events", count: counts.events, color: "text-violet-700", activeColor: "bg-violet-600 text-white" },
    { value: "seo", label: "SEO", count: counts.seo, color: "text-sky-700", activeColor: "bg-sky-600 text-white" },
    { value: "content", label: "Content", count: counts.content, color: "text-teal-700", activeColor: "bg-teal-600 text-white" },
  ]

  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const isActive = (searchParams?.get("source") ?? "") === tab.value
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleClick(tab.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              isActive
                ? tab.activeColor + " shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function InsightTabs(props: Props) {
  return (
    <Suspense fallback={<div className="h-8" />}>
      <InsightTabsInner {...props} />
    </Suspense>
  )
}
