import type { ReactNode } from "react"

interface PanelProps {
  title?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  scrollable?: boolean
}

export default function Panel({
  title,
  icon,
  actions,
  children,
  className = "",
  scrollable = false,
}: PanelProps) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-border bg-card ${className}`}>
      {title && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
            {icon && <span className="h-[13px] w-[13px] text-primary">{icon}</span>}
            {title}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={scrollable ? "flex-1 overflow-y-auto" : "flex-1"}>
        {children}
      </div>
    </div>
  )
}
