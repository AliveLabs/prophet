"use client"

import { useState, useMemo, type ReactNode } from "react"
import CompetitorCard from "@/components/competitors/competitor-card"
import DiscoverForm from "@/components/competitors/discover-form"
import type { CompetitorSignalAggregate } from "@/lib/competitors/helpers"

type SortMode = "threat" | "alpha" | "activity" | "distance"

const SORT_TABS: { key: SortMode; label: string }[] = [
  { key: "threat", label: "Top Threat" },
  { key: "alpha", label: "A – Z" },
  { key: "activity", label: "Recent Activity" },
  { key: "distance", label: "Nearest" },
]

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
}

export type CompetitorForList = {
  id: string
  name: string | null
  category: string | null
  metadata: unknown
}

type CompetitorsClientProps = {
  approved: CompetitorForList[]
  candidates: CompetitorForList[]
  signalMap: Record<string, CompetitorSignalAggregate>
  selectedLocationId: string
  quickFacts: string[]
  discoverAction: (formData: FormData) => void
  tableView: ReactNode
  totalNearby: number
}

export default function CompetitorsClient({
  approved,
  candidates,
  signalMap,
  selectedLocationId,
  quickFacts,
  discoverAction,
  tableView,
  totalNearby,
}: CompetitorsClientProps) {
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortMode>("threat")
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards")
  const [addOpen, setAddOpen] = useState(false)

  const filteredApproved = useMemo(() => {
    let list = [...approved]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.category ?? "").toLowerCase().includes(q)
      )
    }
    switch (sort) {
      case "threat":
        list.sort((a, b) => {
          const sa = signalMap[a.id] ?? { severity: "info", signalCount: 0 }
          const sb = signalMap[b.id] ?? { severity: "info", signalCount: 0 }
          const diff =
            (SEVERITY_WEIGHT[sb.severity] ?? 0) -
            (SEVERITY_WEIGHT[sa.severity] ?? 0)
          if (diff !== 0) return diff
          return sb.signalCount - sa.signalCount
        })
        break
      case "alpha":
        list.sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "")
        )
        break
      case "activity":
        list.sort((a, b) => {
          const sa = signalMap[a.id]?.topSignal?.dateKey ?? ""
          const sb = signalMap[b.id]?.topSignal?.dateKey ?? ""
          return sb.localeCompare(sa)
        })
        break
      case "distance":
        list.sort((a, b) => {
          const da =
            ((a.metadata as Record<string, unknown> | null)
              ?.distanceMeters as number) ?? Infinity
          const db =
            ((b.metadata as Record<string, unknown> | null)
              ?.distanceMeters as number) ?? Infinity
          return da - db
        })
        break
    }
    return list
  }, [approved, search, sort, signalMap])

  const filteredCandidates = useMemo(() => {
    if (!search) return candidates
    const q = search.toLowerCase()
    return candidates.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.category ?? "").toLowerCase().includes(q)
    )
  }, [candidates, search])

  const totalResults = filteredApproved.length + filteredCandidates.length
  const countLabel = search
    ? `${totalResults} result${totalResults !== 1 ? "s" : ""}`
    : `${approved.length} of ${totalNearby} nearby`

  return (
    <>
      {/* Search */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10.5 10.5l2.5 2.5" />
          </svg>
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search competitors…"
          className="w-full rounded-[10px] border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-deep-violet focus:border-primary/28"
        />
      </div>

      {/* Sort tabs */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none" role="tablist">
        {SORT_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={sort === tab.key}
            onClick={() => setSort(tab.key)}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium tracking-wide transition-all ${
              sort === tab.key
                ? "border-primary/30 bg-primary/14 text-vatic-indigo-soft"
                : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Section header + view toggle */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-deep-violet">
            Tracked Competitors
          </span>
          <span className="text-[11px] text-deep-violet">{countLabel}</span>
        </div>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          <button
            onClick={() => setViewMode("cards")}
            className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              viewMode === "cards"
                ? "bg-primary/14 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Card view"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1" y="1" width="5" height="5" rx="1" />
              <rect x="8" y="1" width="5" height="5" rx="1" />
              <rect x="1" y="8" width="5" height="5" rx="1" />
              <rect x="8" y="8" width="5" height="5" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              viewMode === "table"
                ? "bg-primary/14 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Table view"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M1 3h12M1 7h12M1 11h12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Cards or Table view */}
      {viewMode === "cards" ? (
        <div className="flex flex-col gap-2">
          {/* Tracked cards */}
          {filteredApproved.map((c) => (
            <CompetitorCard
              key={c.id}
              competitor={c}
              signals={
                signalMap[c.id] ?? {
                  severity: "info" as const,
                  signalCount: 0,
                  topSignal: null,
                }
              }
            />
          ))}

          {/* Empty state */}
          {totalResults === 0 && search && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="text-4xl opacity-40">🔍</span>
              <p className="text-sm font-medium text-muted-foreground">
                No competitors found
              </p>
              <p className="text-xs text-deep-violet">
                Try a different name or category
              </p>
            </div>
          )}

          {/* Candidate cards */}
          {filteredCandidates.length > 0 && (
            <>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-deep-violet">
                  Candidates
                </span>
                <span className="text-[11px] text-deep-violet">
                  {filteredCandidates.length} pending
                </span>
              </div>
              {filteredCandidates.map((c) => (
                <CompetitorCard
                  key={c.id}
                  competitor={c}
                  signals={{
                    severity: "info",
                    signalCount: 0,
                    topSignal: null,
                  }}
                  isCandidate
                />
              ))}
            </>
          )}
        </div>
      ) : (
        tableView
      )}

      {/* Add competitor card */}
      <div className="mt-1">
        {!addOpen ? (
          <button
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-primary/22 bg-transparent p-4 text-left transition-all hover:border-primary/48 hover:bg-primary/5 active:scale-[0.98]"
          >
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-primary/12">
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-vatic-indigo-soft"
              >
                <path d="M9 3v12M3 9h12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-vatic-indigo-soft">
                Track a new competitor
              </p>
              <p className="mt-0.5 text-xs text-deep-violet">
                Search by name, address, or Google Maps link
              </p>
            </div>
          </button>
        ) : (
          <div className="rounded-[14px] border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">
                Discover competitors
              </p>
              <button
                onClick={() => setAddOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            <DiscoverForm
              action={discoverAction}
              selectedLocationId={selectedLocationId}
              quickFacts={quickFacts}
            />
          </div>
        )}
      </div>
    </>
  )
}
