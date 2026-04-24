// Runs on the client at app boot (Next.js 15+ convention). This is where we
// initialize the posthog-js singleton so every client component can import
// `posthog` from "posthog-js" and call methods without re-initializing.
//
// `api_host` points at our /ingest reverse-proxy (configured in next.config.ts)
// so requests bypass ad-blockers that block *.posthog.com directly. `ui_host`
// still points at PostHog so the in-app toolbar links open correctly.

import posthog from "posthog-js"

if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "/ingest",
    ui_host: "https://us.posthog.com",
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_exceptions: true,
    session_recording: {
      // Default to maximum privacy for v1: mask every input AND every text
      // node in replays. Dashboards render customer / competitor / revenue
      // data that should never leave our origin. `maskTextSelector: "*"` is
      // the posthog-js / rrweb way to mask all text (there is no dedicated
      // `maskAllText` option). Add an opt-in unmask class later if we audit
      // specific non-sensitive regions.
      maskAllInputs: true,
      maskTextSelector: "*",
    },
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.debug()
    },
  })
}
