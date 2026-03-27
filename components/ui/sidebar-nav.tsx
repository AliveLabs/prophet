"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type ReactNode, useState, useRef, useEffect, useTransition } from "react"
import { switchOrganizationAction } from "@/app/(dashboard)/actions"

export interface OrgEntry {
  id: string
  name: string
  tier: string
  role: string
}

interface NavItem {
  href: string
  label: string
  icon: ReactNode
  badge?: number
  badgeColor?: "indigo" | "gold"
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        href: "/home",
        label: "Overview",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
            <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" />
            <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" />
            <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        href: "/insights",
        label: "Insights",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M7.5 2 C7.5 2 4 4 1.5 7.5 C4 11 7.5 13 7.5 13 C7.5 13 11 11 13.5 7.5 C11 4 7.5 2 7.5 2Z" />
            <circle cx="7.5" cy="7.5" r="2" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Competitors",
    items: [
      {
        href: "/competitors",
        label: "My Competitors",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="5" cy="5.5" r="2.8" />
            <circle cx="10.5" cy="5.5" r="2.8" />
            <path d="M1 13.5 C1 11 2.5 10 5 10" />
            <path d="M14 13.5 C14 11 12.5 10 10.5 10" />
          </svg>
        ),
      },
      {
        href: "/social",
        label: "Social Intel",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Market",
    items: [
      {
        href: "/events",
        label: "Events",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="2" width="13" height="11" rx="1.5" />
            <path d="M4 0.5 L4 3.5M11 0.5 L11 3.5M1 5.5 L14 5.5" />
          </svg>
        ),
      },
      {
        href: "/visibility",
        label: "Visibility",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <polyline points="1,12 4,8 7,9.5 10,5 14,2.5" />
            <path d="M10 2.5 L14 2.5 L14 6.5" />
          </svg>
        ),
      },
      {
        href: "/traffic",
        label: "Busy Times",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M3 13.125 L3 8M7.5 13.125 L7.5 4.5M12 13.125 L12 1" />
          </svg>
        ),
      },
      {
        href: "/weather",
        label: "Weather",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M7.5 1 L7.5 3M7.5 12 L7.5 14M1 7.5 L3 7.5M12 7.5 L14 7.5" />
            <circle cx="7.5" cy="7.5" r="2.5" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Content",
    items: [
      {
        href: "/content",
        label: "Menu & Website",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="2" width="13" height="11" rx="1.5" />
            <path d="M4 6 L7 9 L11 4.5" />
          </svg>
        ),
      },
      {
        href: "/photos",
        label: "Photos",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1" y="2.5" width="13" height="10" rx="1.5" />
            <circle cx="4.5" cy="5.5" r="1.5" />
            <path d="M1 10 L5 7 L8 9 L11 6 L14 8.5" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        href: "/locations",
        label: "Locations",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M7.5 1 C4.5 1 2 3.5 2 6.5 C2 10 7.5 14 7.5 14 C7.5 14 13 10 13 6.5 C13 3.5 10.5 1 7.5 1Z" />
            <circle cx="7.5" cy="6.5" r="2" />
          </svg>
        ),
      },
      {
        href: "/settings",
        label: "Settings",
        icon: (
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="7.5" cy="7.5" r="2.2" />
            <path d="M7.5 1 L7.5 2.5M7.5 12.5 L7.5 14M1 7.5 L2.5 7.5M12.5 7.5 L14 7.5M3.1 3.1 L4.2 4.2M10.8 10.8 L11.9 11.9M11.9 3.1 L10.8 4.2M4.2 10.8 L3.1 11.9" />
          </svg>
        ),
      },
    ],
  },
]

interface SidebarNavProps {
  userName?: string
  userOrg?: string
  orgs?: OrgEntry[]
  currentOrgId?: string
}

export default function SidebarNav({ userName, userOrg, orgs = [], currentOrgId }: SidebarNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const popoverRef = useRef<HTMLDivElement>(null)

  const initials =
    userName
      ?.split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "V"

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  function handleSwitchOrg(orgId: string) {
    if (orgId === currentOrgId || isPending) return
    setOpen(false)
    startTransition(async () => {
      await switchOrganizationAction(orgId)
    })
  }

  const tierLabel = (tier: string) => {
    if (tier === "free") return null
    return tier.charAt(0).toUpperCase() + tier.slice(1)
  }

  return (
    <>
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground first:mt-2">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-nav-item group relative flex items-center gap-3 rounded-md px-3 py-[9px] text-[13.5px] transition-all duration-150 ${
                    isActive
                      ? "bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-[55%] w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <span className={`sidebar-icon h-[15px] w-[15px] shrink-0 ${isActive ? "opacity-100" : "opacity-65 group-hover:opacity-100"}`}>
                    {item.icon}
                  </span>
                  <span className="sidebar-label">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`sidebar-badge ml-auto min-w-[20px] rounded-full px-[7px] py-px text-center text-[10.5px] font-semibold leading-[18px] ${
                        item.badgeColor === "gold"
                          ? "bg-signal-gold text-midnight"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="relative shrink-0 border-t border-border px-3 py-3" ref={popoverRef}>
        {/* Org switcher popover */}
        {open && orgs.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 rounded-lg border border-border bg-card shadow-lg">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Organizations
            </div>
            <div className="max-h-[220px] overflow-y-auto">
              {orgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleSwitchOrg(org.id)}
                  disabled={isPending}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors ${
                    org.id === currentOrgId
                      ? "bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  } ${isPending ? "opacity-50" : ""}`}
                >
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-primary/15 text-[9px] font-bold text-primary">
                    {org.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {tierLabel(org.tier) && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                      {tierLabel(org.tier)}
                    </span>
                  )}
                  {org.id === currentOrgId && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-primary">
                      <path d="M2 6 L5 9 L10 3" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-border">
              <Link
                href="/organizations/new"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-dashed border-muted-foreground/40 text-[11px] text-muted-foreground">
                  +
                </span>
                <span>New organization</span>
              </Link>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-secondary"
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-deep-indigo text-[11px] font-bold text-primary-foreground">
            {initials}
          </div>
          <div className="sidebar-label min-w-0 flex-1 text-left">
            <div className="truncate text-[12.5px] font-medium text-foreground">
              {userName ?? "User"}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {userOrg ?? "Vatic"}
            </div>
          </div>
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            className={`sidebar-label shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M2.5 4.5 L6.5 8.5 L10.5 4.5" />
          </svg>
        </button>
      </div>
    </>
  )
}
