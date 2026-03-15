"use client"

import ThemeToggle from "./theme-toggle"

interface TopbarProps {
  userName?: string
  signalCount?: number
}

export default function Topbar({ userName, signalCount }: TopbarProps) {
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
          {signalCount !== undefined && signalCount > 0 && (
            <> &middot; {signalCount} new signal{signalCount !== 1 ? "s" : ""}</>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="hidden items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-0 sm:flex" style={{ height: 34, width: 210 }}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            className="shrink-0 text-muted-foreground"
          >
            <circle cx="5.5" cy="5.5" r="4" />
            <path d="M8.5 8.5 L12 12" />
          </svg>
          <span className="text-[12.5px] text-muted-foreground">
            Search&hellip;
          </span>
        </div>

        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

        {/* Notifications */}
        <button
          type="button"
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-secondary/50 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Notifications"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M7.5 1.5 C5 1.5 3 3.5 3 6 L3 9.5 L1.5 11 L13.5 11 L12 9.5 L12 6 C12 3.5 10 1.5 7.5 1.5Z" />
            <path d="M6 11 C6 11.8 6.7 12.5 7.5 12.5 C8.3 12.5 9 11.8 9 11" />
          </svg>
          {signalCount !== undefined && signalCount > 0 && (
            <span className="absolute right-[5px] top-[5px] h-[7px] w-[7px] rounded-full border-[1.5px] border-background bg-signal-gold" />
          )}
        </button>

        {/* Theme toggle */}
        <ThemeToggle />
      </div>
    </header>
  )
}
