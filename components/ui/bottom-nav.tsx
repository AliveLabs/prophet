"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const ITEMS = [
  {
    href: "/home",
    label: "Overview",
    icon: (
      <svg width="22" height="22" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
        <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" />
        <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" />
        <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/insights",
    label: "Feed",
    icon: (
      <svg width="22" height="22" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M7.5 2 C7.5 2 4 4 1.5 7.5 C4 11 7.5 13 7.5 13 C7.5 13 11 11 13.5 7.5 C11 4 7.5 2 7.5 2Z" />
        <circle cx="7.5" cy="7.5" r="2" />
      </svg>
    ),
  },
  {
    href: "/competitors",
    label: "Rivals",
    icon: (
      <svg width="22" height="22" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="5" cy="5.5" r="2.8" />
        <circle cx="10.5" cy="5.5" r="2.8" />
        <path d="M1 13.5 C1 11 2.5 10 5 10" />
        <path d="M14 13.5 C14 11 12.5 10 10.5 10" />
      </svg>
    ),
  },
  {
    href: "/social",
    label: "Social",
    icon: (
      <svg width="22" height="22" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M7.5 1.5 C5 1.5 3 3.5 3 6 L3 9.5 L1.5 11 L13.5 11 L12 9.5 L12 6 C12 3.5 10 1.5 7.5 1.5Z" />
        <path d="M6 11 C6 11.8 6.7 12.5 7.5 12.5 C8.3 12.5 9 11.8 9 11" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "More",
    icon: (
      <svg width="22" height="22" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="7.5" cy="3" r="1" />
        <circle cx="7.5" cy="7.5" r="1" />
        <circle cx="7.5" cy="12" r="1" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 hidden h-[58px] items-stretch border-t border-border bg-card max-md:flex">
      {ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-medium transition-colors ${
              isActive ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {isActive && (
              <span className="absolute left-1/2 top-0 h-0.5 w-7 -translate-x-1/2 rounded-b bg-primary" />
            )}
            {item.icon}
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
