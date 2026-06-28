"use client"

import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

function useIsMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useIsMounted()

  // When a `className` is supplied (e.g. the operator shell's Pass-styled
  // `.pv-theme-btn`), that class owns the entire appearance — surface, border,
  // shadow, hover — via design tokens. Without one, fall back to the shadcn
  // chrome used on admin / landing / standalone topbar surfaces.
  const appearance = className
    ? className
    : "rounded-lg border border-border bg-card text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

  if (!mounted) {
    // Placeholder must match the rendered button's footprint to avoid layout
    // shift. The Pass class sizes itself (38px); the shadcn fallback is 36px.
    return <div className={className ? className : "h-9 w-9"} aria-hidden />
  }

  const isDark = resolvedTheme === "dark"

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`group relative inline-flex items-center justify-center ${
        className ? "" : "h-9 w-9 "
      }${appearance}`}
    >
      {/* Sun — visible in dark mode */}
      <svg
        className={`absolute h-[18px] w-[18px] transition-all duration-300 ${
          isDark
            ? "rotate-0 scale-100 opacity-100"
            : "rotate-90 scale-0 opacity-0"
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>

      {/* Moon — visible in light mode */}
      <svg
        className={`absolute h-[18px] w-[18px] transition-all duration-300 ${
          isDark
            ? "-rotate-90 scale-0 opacity-0"
            : "rotate-0 scale-100 opacity-100"
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    </button>
  )
}
