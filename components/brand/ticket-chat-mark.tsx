import type { SVGProps } from "react"

/**
 * Ticket "T" inside a chat bubble — covers both meanings at once: the Ticket brand
 * mark AND "ask / chat". Used as the trigger for the "Ask Ticket about this" popover
 * (ALT-230). Outline + T both render in `currentColor` (set it to copper/rust),
 * with an optional faint tint fill so the bubble reads as a container.
 *
 * `shape`:
 *   - "square" — messenger-style rounded-rect bubble (matches the chat glyph used in
 *     the popover's "Ask Ticket about this" action; most consistent).
 *   - "round"  — circular speech bubble (softer/friendlier).
 */

type TicketChatMarkProps = Omit<SVGProps<SVGSVGElement>, "fill"> & {
  size?: number
  shape?: "square" | "round"
  /** faint tint fill inside the bubble so it reads as a filled container */
  tint?: boolean
}

const BUBBLE: Record<"square" | "round", string> = {
  // Rounded-rect chat bubble, tail bottom-left (same family as the popover's "Ask" glyph).
  square: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  // Circular speech bubble, tail bottom-left.
  round:
    "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
}

export function TicketChatMark({
  size = 18,
  shape = "square",
  tint = false,
  className,
  ...props
}: TicketChatMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path
        d={BUBBLE[shape]}
        fill={tint ? "var(--rust-tint)" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Ticket T — compact + centered in the bubble body (above the tail). */}
      <rect x="7.5" y="6.8" width="9" height="2.1" rx="0.5" fill="currentColor" />
      <rect x="10.7" y="6.8" width="2.6" height="7.2" rx="0.4" fill="currentColor" />
    </svg>
  )
}
