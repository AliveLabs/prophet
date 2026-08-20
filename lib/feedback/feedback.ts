// ALT-371 / ALT-695 — pure shared logic (no "use server", so the server actions and the client
// launchers can all import these without pulling server-only code into the bundle).
//
// ── Two doors, one queue (ALT-695) ──────────────────────────────────────────────────────────
// The authed "Help" launcher and the logged-out "Trouble signing in?" form write to the SAME
// table and flow through the SAME Notion sync. They share no component, because the authed
// modal's whole value is the context it captures automatically (page, org, location, user), and
// making one component serve a session-less caller turns every one of those fields optional.
//
// What they DO share is this file: the subject vocabulary, the validation, and the reference id.

// ── Subjects ────────────────────────────────────────────────────────────────────────────────
// Support first, feedback last. Of the first 8 real inbound rows, SIX were data-correctness
// complaints and two of those were count mismatches ("says 5 competitors, shows 3"). That is the
// class that cannot be answered from the message alone, and once locations and competitors are
// purchased quantities it is a BILLING dispute rather than a papercut.
//
// The four original feedback categories are kept and keep their exact string values, because 8
// production rows already carry `issue`, `idea` and null. Widening a union is backward compatible;
// renaming a value would orphan those rows.
export const SUPPORT_SUBJECTS = [
  "brief_wrong",
  "no_data_yet",
  "competitors_wrong",
  "billing",
  "add_location",
  "account_access",
  "other",
] as const

export const FEEDBACK_SUBJECTS = ["idea", "confusing", "praise", "issue"] as const

export const FEEDBACK_CATEGORIES = [...SUPPORT_SUBJECTS, ...FEEDBACK_SUBJECTS] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

// Operator-facing labels. Plain language, no internal wording, no provider names, no em dashes.
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  brief_wrong: "Something in my brief looks wrong",
  no_data_yet: "I'm not seeing any data yet",
  competitors_wrong: "My competitors are wrong",
  billing: "Billing, plan or invoice",
  add_location: "Add, change or remove a location",
  account_access: "Who can access my account",
  other: "Something else",
  idea: "Idea",
  confusing: "Confusing",
  praise: "Love it",
  issue: "Something's off",
}

// ── The logged-out door ─────────────────────────────────────────────────────────────────────
// Deliberately NOT the full list. If you cannot log in, your problem is one of three things, and
// offering "something in my brief looks wrong" to someone who cannot see their brief invites
// misrouted submissions and gives us worse data than no category at all.
//
// All three have a known fast path (resend the link, look up the email, check the org), which is
// also the first place a canned response is worth writing.
export const SIGNIN_SUBJECTS = ["signin_link", "signin_email", "signin_other"] as const
export type SigninSubject = (typeof SIGNIN_SUBJECTS)[number]

export const SIGNIN_SUBJECT_LABELS: Record<SigninSubject, string> = {
  signin_link: "My sign-in link never arrived",
  signin_email: "I'm not sure which email I signed up with",
  signin_other: "Something else about getting in",
}

export const FEEDBACK_MAX_MESSAGE = 4000
export const MAX_EMAIL = 320 // RFC-ish practical ceiling
export const MAX_BUSINESS_NAME = 200

// A client-supplied tag is only kept if it's one we know; anything else becomes null (same
// forward-compatible stance as dismiss-reason codes). Accepts the sign-in subjects too, so the
// logged-out door can use one normalizer.
const ALL_SUBJECTS: readonly string[] = [...FEEDBACK_CATEGORIES, ...SIGNIN_SUBJECTS]

export function normalizeCategory(c: string | null | undefined): string | null {
  if (!c) return null
  return ALL_SUBJECTS.includes(c) ? c : null
}

/** True when the subject belongs to the logged-out sign-in door. */
export function isSigninSubject(c: string | null | undefined): c is SigninSubject {
  return !!c && (SIGNIN_SUBJECTS as readonly string[]).includes(c)
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

/** Deliberately permissive: one @, something either side, no spaces. A stricter regex rejects
 *  valid addresses, and the cost of accepting a typo is a bounced reply, while the cost of
 *  rejecting a real address is a support request we never receive. */
export function normalizeEmail(e: string | null | undefined): string | null {
  const trimmed = (e ?? "").trim().toLowerCase().slice(0, MAX_EMAIL)
  if (!trimmed) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

export function normalizeBusinessName(n: string | null | undefined): string | null {
  const trimmed = (n ?? "").trim()
  return trimmed ? trimmed.slice(0, MAX_BUSINESS_NAME) : null
}

// ── Reference id ────────────────────────────────────────────────────────────────────────────
/** A short, sayable handle on a request, derived from its row id.
 *
 *  Shown on screen and in the confirmation email. Without one, somebody who is not sure their
 *  message arrived sends it again through another channel, and a support queue doubles for no
 *  reason. Derived rather than stored so there is no second identifier to keep in sync, and
 *  uppercase hex so it survives being read down a phone. */
export function referenceFor(rowId: string): string {
  const hex = rowId.replace(/-/g, "").slice(0, 6).toUpperCase()
  return `TK-${hex}`
}
