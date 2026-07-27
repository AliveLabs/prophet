// Resolves the origin the browser should be sent back to after an interactive auth
// round-trip (Google OAuth, magic link) — the `redirectTo` handed to Supabase.
//
// Problem this solves (ALT-442): a single fixed NEXT_PUBLIC_APP_URL sends every Vercel
// preview deployment's callback to prod (or, when the var is unset on preview, to
// localhost), so logging in on a preview never returns to that preview and looks broken.
// Emails, cron, and Stripe deliberately keep using the canonical NEXT_PUBLIC_APP_URL
// (a link in an email should always point at app.getticket.ai, whichever deploy sent it).
// Only the interactive return trip must target the deployment actually serving the request.
//
// Priority:
//   production -> NEXT_PUBLIC_APP_URL (canonical), falling back to the deploy's own URL
//   preview    -> this deployment's URL (stable branch alias if present, else the unique
//                 per-deploy URL) so the callback comes back here
//   local/dev  -> NEXT_PUBLIC_APP_URL if set, else http://localhost:3000
//
// Server-only: VERCEL_URL / VERCEL_BRANCH_URL are runtime-only (not NEXT_PUBLIC_), so this
// must be called from server actions or route handlers, never a client component.

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "")
}

export function getAppOrigin(): string {
  const canonical = process.env.NEXT_PUBLIC_APP_URL
    ? stripTrailingSlash(process.env.NEXT_PUBLIC_APP_URL)
    : undefined

  switch (process.env.VERCEL_ENV) {
    case "production":
      if (canonical) return canonical
      if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
      break
    case "preview": {
      // Prefer the branch alias (stable per branch, so it maps to one predictable
      // Supabase redirect-allowlist entry) over the unique per-deploy hash URL.
      const host = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
      if (host) return `https://${host}`
      break
    }
  }

  return canonical ?? "http://localhost:3000"
}

export function getAuthCallbackUrl(): string {
  return `${getAppOrigin()}/auth/callback`
}
