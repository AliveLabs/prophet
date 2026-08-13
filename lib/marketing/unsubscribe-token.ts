import { createHmac, timingSafeEqual } from "node:crypto"

// D7 unsubscribe: HMAC-signed link tokens shared with Chris's n8n lifecycle
// emails. The n8n templates SIGN (embed a per-recipient link); this module
// VERIFIES. Both sides hold the same UNSUB_SECRET (see .env.example and
// docs/UNSUBSCRIBE-CONTRACT.md, which is the cross-team contract for the
// exact construction below -- change one only with the other).
//
// Design goals:
//   * Un-guessable and non-enumerating: without the secret you cannot mint a
//     valid link for any address, and an invalid signature tells you nothing
//     about whether the address exists (verification never touches the DB).
//   * No expiry: an unsubscribe link in an old email must keep working.
//   * Fail closed: no secret configured means NOTHING verifies. Never fall
//     back to another key -- this secret is shared out of band with the
//     marketing side and must stay independent of app credentials.
//
// Construction (v1):
//   email   = trim + lowercase of the recipient address
//   message = "unsub.v1." + email                (UTF-8)
//   sig     = base64url( HMAC-SHA256(UNSUB_SECRET, message) ), no padding
//   URL     = /unsubscribe?e=<base64url(email)>&s=<sig>
//
// The `e` param is base64url only to keep raw addresses out of URLs, access
// logs, and referrer headers; it is encoding, not secrecy. The signature is
// the security boundary.

export const UNSUBSCRIBE_TOKEN_VERSION = "v1"

// Generous ceilings so obviously hostile inputs are rejected before any
// crypto work. Real emails encode well under this.
const MAX_PARAM_LENGTH = 512

export function normalizeUnsubscribeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function signingSecret(): string | null {
  const secret = process.env.UNSUB_SECRET
  return secret && secret.length > 0 ? secret : null
}

function hmac(secret: string, normalizedEmail: string): string {
  return createHmac("sha256", secret)
    .update(`unsub.${UNSUBSCRIBE_TOKEN_VERSION}.${normalizedEmail}`, "utf8")
    .digest("base64url")
}

/**
 * Sign a normalized email. Throws when UNSUB_SECRET is unset: the app side
 * only signs in tests and docs tooling, and silently producing an unsigned
 * link would ship a broken footer.
 */
export function signUnsubscribeEmail(email: string): string {
  const secret = signingSecret()
  if (!secret) {
    throw new Error("unsubscribe: UNSUB_SECRET is not set; cannot sign")
  }
  return hmac(secret, normalizeUnsubscribeEmail(email))
}

/** Build the query string shared by the page and the one-click endpoint. */
export function buildUnsubscribeParams(email: string): {
  e: string
  s: string
} {
  const normalized = normalizeUnsubscribeEmail(email)
  return {
    e: Buffer.from(normalized, "utf8").toString("base64url"),
    s: signUnsubscribeEmail(normalized),
  }
}

/**
 * Verify the `e` (base64url email) and `s` (base64url HMAC) query params.
 * Returns the normalized email on success, null on ANY failure: missing
 * params, oversized params, undecodable email, bad signature, or missing
 * secret (fail closed). Callers must render the same neutral state for every
 * null -- the reason is deliberately not distinguished.
 *
 * The decoded email is normalized before verification, so a signer who
 * encodes "Foo@Bar.com" but signs the normalized form still verifies.
 */
export function verifyUnsubscribeParams(
  e: string | null | undefined,
  s: string | null | undefined
): string | null {
  if (!e || !s) return null
  if (e.length > MAX_PARAM_LENGTH || s.length > MAX_PARAM_LENGTH) return null

  const secret = signingSecret()
  if (!secret) return null

  let email: string
  try {
    email = normalizeUnsubscribeEmail(
      Buffer.from(e, "base64url").toString("utf8")
    )
  } catch {
    return null
  }
  if (!email || !email.includes("@")) return null

  const expected = Buffer.from(hmac(secret, email))
  const provided = Buffer.from(s)
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  return email
}
