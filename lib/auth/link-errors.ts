// Supabase bounces a FAILED magic-link verification back to our redirect target
// with error params instead of a `code` (query string on the PKCE path, hash
// fragment on the implicit one). Both of our landing surfaces used to drop those
// params on the floor: /auth/callback saw no `code`, found no session, and
// redirected to a bare /login; HashTokenHandler bailed unless the hash carried
// `access_token=`. The operator was told nothing, and we recorded nothing — which
// is why two beta invitees "couldn't get in" with no trace on our side.
//
// Map the codes we can actually act on to operator-facing copy. Everything else
// gets one honest fallback that still routes them to the fix (ask for a new link).

/** Copy for a link that is stale or has already been consumed. */
export const EXPIRED_LINK_MESSAGE =
  "That sign-in link has expired. Enter your email below and we'll send you a fresh one."

/** Copy for a link the auth server rejected for any other reason. */
export const INVALID_LINK_MESSAGE =
  "We couldn't sign you in with that link. Enter your email below and we'll send a fresh one."

export interface AuthLinkErrorParams {
  error?: string | null
  errorCode?: string | null
  errorDescription?: string | null
}

/**
 * Operator-facing copy for a failed link verification, or null when the params
 * carry no error at all (the normal success path).
 */
export function describeAuthLinkError({
  error,
  errorCode,
  errorDescription,
}: AuthLinkErrorParams): string | null {
  if (!error && !errorCode && !errorDescription) return null

  const code = (errorCode ?? "").toLowerCase()
  const description = (errorDescription ?? "").toLowerCase()

  // `otp_expired` covers BOTH a stale link and one that was already consumed.
  // Corporate mail scanners (Outlook SafeLinks, Proofpoint & co) pre-click links
  // to check them, which burns the single-use token — so this copy has to read
  // correctly for an operator who never clicked anything.
  if (code === "otp_expired" || description.includes("expired")) {
    return EXPIRED_LINK_MESSAGE
  }

  return INVALID_LINK_MESSAGE
}

/** Pull the error params out of a URL's query string. */
export function readAuthLinkErrorFromSearch(params: URLSearchParams): string | null {
  return describeAuthLinkError({
    error: params.get("error"),
    errorCode: params.get("error_code"),
    errorDescription: params.get("error_description"),
  })
}
