"use client"

// The "or / Continue with Google" block, owning its own divider so the two
// disappear together. Inside an in-app browser (a Meta ad click opens in the
// Facebook/Instagram webview) Google refuses to run OAuth at all
// (disallowed_useragent), so offering the button there is offering an error:
// swap it for a note that points at the email path, which works everywhere.
//
// useSyncExternalStore for an SSR-safe one-time read (server says "real
// browser", the client corrects itself on mount) — same pattern as
// components/marketing-pixels.tsx, and the store never notifies because a
// page's user agent never changes.

import { useSyncExternalStore } from "react"
import { isInAppBrowserUA } from "@/lib/auth/in-app-browser"
import { signInWithGoogleAction } from "./login/actions"
import { AuthGoogleIcon } from "./login/auth-icons"

const subscribeNever = () => () => {}

export function GoogleSignIn() {
  const inAppBrowser = useSyncExternalStore(
    subscribeNever,
    () => isInAppBrowserUA(navigator.userAgent),
    () => false
  )

  if (inAppBrowser) {
    return (
      <p className="auth-fine">
        Google sign-in doesn&apos;t work inside this app&apos;s built-in
        browser. Use your email above and we&apos;ll send you a code.
      </p>
    )
  }

  return (
    <>
      <div className="auth-or">
        <span>or</span>
      </div>

      <form action={signInWithGoogleAction}>
        <button type="submit" className="auth-social">
          <AuthGoogleIcon />
          Continue with Google
        </button>
      </form>
    </>
  )
}
