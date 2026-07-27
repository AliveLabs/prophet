"use client"

// "Ask Ticket about this" ingress for play detail (ALT-259).
//
// The VizTBubble ingress (ALT-230) offers Generate-insight + Ask on data-viz cards.
// On a play's recipe STEPS and its EVIDENCE that Generate action is nonsensical (the
// play already IS the generated insight), so this is an ASK-ONLY affordance: same
// Ticket-chat glyph and the same editable `/ask?q=` contract (ALT-183), no popover.
//
// Placement per Bryan's call on ALT-259: a small icon on each recipe STEP (someone
// executing a step may have a question) and ONE inline "Ask about this evidence" on
// the signals SECTION — never per-signal, which would just add visual noise.

import { useRouter } from "next/navigation"
import { TicketChatMark } from "@/components/brand/ticket-chat-mark"
import { tkcx as cx } from "./primitives"

// Question builders live in the server-safe ./ask-question module (the /home/[rank] detail
// page is a Server Component and calls them at render time — they can't come from this
// "use client" file). Re-exported from the ticket index alongside this component.

export function AskTicket({
  question,
  variant = "icon",
  label = "Ask Ticket about this",
  className,
}: {
  /** the pre-filled, editable question routed to /ask?q= */
  question: string
  /** "icon" = bare chat glyph (recipe steps); "inline" = glyph + label (evidence section) */
  variant?: "icon" | "inline"
  label?: string
  className?: string
}) {
  const router = useRouter()
  function ask() {
    router.push(`/ask?q=${encodeURIComponent(question)}`)
  }

  if (variant === "inline") {
    return (
      <button type="button" className={cx("tk-ask-inline", className)} onClick={ask}>
        <TicketChatMark size={16} shape="square" />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className={cx("tk-ask-icon", className)}
      onClick={ask}
      aria-label={label}
      title={label}
    >
      <TicketChatMark size={18} shape="square" />
    </button>
  )
}
