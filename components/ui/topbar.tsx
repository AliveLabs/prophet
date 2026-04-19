"use client"

import ThemeToggle from "./theme-toggle"

interface TopbarProps {
  userName?: string
}

export default function Topbar({ userName }: TopbarProps) {
  const now = new Date()
  const hour = now.getHours()
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  const firstName = userName?.split(" ")[0] ?? "there"

  return (
    <header className="topbar flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-background px-6 max-md:h-[54px] max-md:px-4">
      <div>
        <div className="text-[13.5px] font-medium text-foreground">
          {greeting}, {firstName}
        </div>
        <div className="mt-px text-[11.5px] text-muted-foreground max-md:max-w-[200px] max-md:truncate">
          {dateStr}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <ThemeToggle />
      </div>
    </header>
  )
}
