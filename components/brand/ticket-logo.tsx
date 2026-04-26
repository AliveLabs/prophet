import type { SVGProps } from "react"

/**
 * Ticket "T" mark — theme-aware vector logo.
 *
 * The body of the T uses `currentColor`, and the perforation cutouts use
 * `var(--background)`, so the mark renders as Ink-on-Newsprint in light mode
 * and Newsprint-on-Ink in dark mode automatically — matching the static
 * SVGs in `/public/ticket/assets/svg/ticket-mark-{dark,full}.svg`.
 *
 * Per brand guidelines, perforations only render at 48px+. Below that we
 * fall back to a clean, simplified T (matching ticket-favicon.svg).
 */

type TicketLogoProps = Omit<SVGProps<SVGSVGElement>, "fill" | "viewBox"> & {
  size?: number
  /** When true, drops the perforations regardless of size. */
  simplified?: boolean
}

export function TicketLogo({
  size = 28,
  simplified,
  className,
  ...props
}: TicketLogoProps) {
  const usePerforations = !simplified && size >= 48

  if (!usePerforations) {
    return (
      <svg
        width={size}
        height={(size * 28) / 22}
        viewBox="0 0 22 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={className}
        {...props}
      >
        <rect x="0" y="0" width="22" height="5" rx="0.6" fill="currentColor" />
        <rect x="6.5" y="5" width="9" height="23" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={(size * 114) / 72}
      viewBox="0 0 72 114"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <rect x="0" y="0" width="72" height="14" rx="1.5" fill="currentColor" />
      <rect x="18" y="14" width="36" height="100" fill="currentColor" />
      <circle cx="18" cy="16" r="3.5" className="fill-background" />
      <circle cx="54" cy="16" r="3.5" className="fill-background" />
      <line
        x1="21.5"
        y1="16"
        x2="50.5"
        y2="16"
        className="stroke-background"
        strokeWidth="1.2"
        strokeDasharray="2.5,2"
      />
    </svg>
  )
}

/**
 * Compact "app icon" version — Ticket T inside a rounded square plate.
 * Use for small badges where you want a self-contained mark on any background.
 */
export function TicketCompactLogo({
  size = 32,
  className,
  ...props
}: Omit<TicketLogoProps, "simplified">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <rect width="32" height="32" rx="6" fill="currentColor" />
      <rect x="6" y="7" width="20" height="4" rx="0.5" className="fill-background" />
      <rect x="11" y="11" width="10" height="17" className="fill-background" />
    </svg>
  )
}
