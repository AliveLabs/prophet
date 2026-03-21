"use client"

import { usePathname } from "next/navigation"
import { useMemo, useState } from "react"

interface TabConfig {
  key: string
  label: string
}

const PAGE_TABS: Record<string, TabConfig[]> = {
  "/home": [
    { key: "overview", label: "Overview" },
    { key: "feed", label: "Intelligence Feed" },
    { key: "competitors", label: "My Competitors" },
  ],
  "/insights": [
    { key: "feed", label: "Feed" },
    { key: "briefing", label: "Briefing" },
    { key: "charts", label: "Charts" },
    { key: "social", label: "Social" },
    { key: "photos", label: "Photos" },
  ],
  "/competitors": [
    { key: "list", label: "List" },
    { key: "candidates", label: "Candidates" },
    { key: "discovery", label: "Discovery" },
  ],
  "/social": [
    { key: "posts", label: "Posts" },
    { key: "handles", label: "Handles" },
    { key: "analytics", label: "Analytics" },
  ],
  "/events": [
    { key: "feed", label: "Feed" },
    { key: "venues", label: "Hot Venues" },
    { key: "matched", label: "Matched" },
  ],
  "/visibility": [
    { key: "organic", label: "Organic" },
    { key: "paid", label: "Paid" },
    { key: "keywords", label: "Keywords" },
  ],
  "/content": [
    { key: "website", label: "Website" },
    { key: "menu", label: "Menu" },
    { key: "compare", label: "Compare" },
  ],
  "/photos": [
    { key: "gallery", label: "Gallery" },
    { key: "intelligence", label: "Visual Intelligence" },
  ],
  "/traffic": [
    { key: "heatmap", label: "Heatmap" },
    { key: "peak", label: "Peak Times" },
    { key: "insights", label: "Insights" },
  ],
  "/weather": [
    { key: "forecast", label: "Forecast" },
    { key: "history", label: "History" },
    { key: "insights", label: "Insights" },
  ],
  "/locations": [
    { key: "list", label: "My Locations" },
    { key: "add", label: "Add New" },
  ],
  "/settings": [
    { key: "general", label: "General" },
    { key: "billing", label: "Billing" },
    { key: "team", label: "Team" },
  ],
}

export default function TabBar() {
  const pathname = usePathname()
  const tabs = useMemo(() => {
    const base = "/" + (pathname.split("/")[1] ?? "home")
    return PAGE_TABS[base] ?? []
  }, [pathname])
  const [activeTab, setActiveTab] = useState(tabs[0]?.key ?? "")

  if (tabs.length === 0) return null

  return (
    <div className="tab-bar flex h-[42px] shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background px-6 max-md:h-[40px] max-md:px-4">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key || (!activeTab && tab === tabs[0])
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex h-full items-center whitespace-nowrap border-b-2 px-3 text-[12.5px] font-medium transition-colors ${
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
