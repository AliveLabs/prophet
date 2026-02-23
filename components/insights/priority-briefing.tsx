import type { PriorityItem } from "@/lib/ai/prompts/priority-briefing"
import { SOURCE_COLORS, SOURCE_LABELS, type SourceCategory } from "@/lib/insights/scoring"

type Props = {
  priorities: PriorityItem[]
}

const URGENCY_STYLES = {
  critical: {
    border: "border-l-rose-500",
    badge: "bg-rose-100 text-rose-700",
    icon: "text-rose-500",
    bg: "from-rose-50/80 to-white",
    ring: "ring-rose-100",
  },
  warning: {
    border: "border-l-amber-500",
    badge: "bg-amber-100 text-amber-700",
    icon: "text-amber-500",
    bg: "from-amber-50/80 to-white",
    ring: "ring-amber-100",
  },
  info: {
    border: "border-l-emerald-500",
    badge: "bg-emerald-100 text-emerald-700",
    icon: "text-emerald-500",
    bg: "from-emerald-50/80 to-white",
    ring: "ring-emerald-100",
  },
} as const

const URGENCY_LABEL = {
  critical: "Urgent",
  warning: "This Week",
  info: "Plan Ahead",
} as const

function SourceBadge({ source }: { source: SourceCategory }) {
  const colors = SOURCE_COLORS[source]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
      {SOURCE_LABELS[source]}
    </span>
  )
}

function PriorityCard({ item, rank, featured }: { item: PriorityItem; rank: number; featured?: boolean }) {
  const style = URGENCY_STYLES[item.urgency]

  if (featured) {
    return (
      <div className={`relative overflow-hidden rounded-2xl border border-l-4 ${style.border} bg-gradient-to-br ${style.bg} p-5 shadow-sm ring-1 ${style.ring}`}>
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-800 shadow-sm ring-1 ring-slate-200">
            {rank}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
                {URGENCY_LABEL[item.urgency]}
              </span>
              <SourceBadge source={item.source} />
            </div>

            <h3 className="mt-2 text-base font-bold leading-snug text-slate-900">
              {item.title}
            </h3>

            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {item.why}
            </p>

            <div className="mt-3 flex items-start gap-2 rounded-xl bg-white/80 px-3.5 py-2.5 shadow-sm ring-1 ring-slate-200/60">
              <svg className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <p className="text-xs font-medium leading-snug text-slate-700">
                {item.action}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative rounded-xl border border-l-4 ${style.border} bg-gradient-to-br ${style.bg} p-4 shadow-sm ring-1 ${style.ring} transition hover:shadow-md`}>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200">
          {rank}
        </div>
        <div className="flex items-center gap-1.5">
          <SourceBadge source={item.source} />
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
            {URGENCY_LABEL[item.urgency]}
          </span>
        </div>
      </div>

      <h3 className="text-sm font-semibold leading-snug text-slate-900">
        {item.title}
      </h3>

      <p className="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-2">
        {item.why}
      </p>

      <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-white/70 px-2.5 py-2 ring-1 ring-slate-200/40">
        <svg className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${style.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        <p className="text-[11px] font-medium leading-snug text-slate-700 line-clamp-2">
          {item.action}
        </p>
      </div>
    </div>
  )
}

export default function PriorityBriefing({ priorities }: Props) {
  if (priorities.length === 0) return null

  const [first, ...rest] = priorities

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-orange-100">
          <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Priority Briefing</h2>
          <p className="text-[11px] text-slate-400">AI-generated top priorities across all intelligence sources</p>
        </div>
      </div>

      {/* Featured #1 priority */}
      <PriorityCard item={first} rank={1} featured />

      {/* #2-5 in a 2x2 grid */}
      {rest.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {rest.map((item, i) => (
            <PriorityCard key={i} item={item} rank={i + 2} />
          ))}
        </div>
      )}
    </div>
  )
}
