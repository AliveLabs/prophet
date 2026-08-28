// The one-time email sign-in code, shared between the action that mails one and
// the action that verifies one. Supabase generates the code (generateLink's
// `email_otp`) and OWNS ITS LENGTH: this project's auth config issues 8 digits
// today (measured live 2026-08-28), the GoTrue default is 6, and the setting can
// change without a deploy. So the validator accepts a digit-length RANGE rather
// than one exact length, and no copy anywhere should promise a specific count.
// This module only decides what is well-formed enough to send upstream; GoTrue
// is the judge of whether a code is right.

export const EMAIL_CODE_MIN_LENGTH = 6
export const EMAIL_CODE_MAX_LENGTH = 10

/** Digits the visitor typed, tolerant of the ways people transcribe a code
 *  (spaces, hyphens, copy with surrounding whitespace). Null when what remains
 *  is not a plausible code. */
export function normalizeEmailCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "")
  return /^\d{6,10}$/.test(digits) ? digits : null
}
