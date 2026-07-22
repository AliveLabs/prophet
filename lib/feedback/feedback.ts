// ALT-371 beta feedback — pure shared logic (no "use server", so both the server action and
// the client launcher can import these without pulling server-only code into the bundle).

export const FEEDBACK_CATEGORIES = ["idea", "issue", "confusing", "praise"] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

// Operator-facing chip labels. Plain language, no internal/meta wording.
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  idea: "Idea",
  issue: "Something's off",
  confusing: "Confusing",
  praise: "Love it",
}

export const FEEDBACK_MAX_MESSAGE = 4000

// A client-supplied tag is only kept if it's one we know; anything else → null (same
// forward-compatible stance as dismiss-reason codes).
export function normalizeCategory(c: string | null | undefined): FeedbackCategory | null {
  if (!c) return null
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(c) ? (c as FeedbackCategory) : null
}

// Trim and bound the message. Returns null when there's nothing to send.
export function normalizeMessage(m: string | null | undefined): string | null {
  const trimmed = (m ?? "").trim()
  if (!trimmed) return null
  return trimmed.slice(0, FEEDBACK_MAX_MESSAGE)
}

// Bound the auto-captured route so an odd value can't bloat a row.
export function normalizePagePath(p: string | null | undefined): string | null {
  const trimmed = (p ?? "").trim()
  return trimmed ? trimmed.slice(0, 300) : null
}
