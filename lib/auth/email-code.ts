// The 6-digit email sign-in code, shared between the action that mails one and
// the action that verifies one. Supabase generates the code (generateLink's
// `email_otp`); this module only owns what counts as a well-formed entry, so the
// verify action never sends an obviously malformed guess upstream.

export const EMAIL_CODE_LENGTH = 6

/** Digits the visitor typed, tolerant of the ways people transcribe a code
 *  (spaces, hyphens, copy with surrounding whitespace). Null when what remains
 *  is not exactly a 6-digit code. */
export function normalizeEmailCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "")
  return /^\d{6}$/.test(digits) ? digits : null
}
