// Browser-side marketing tags for the PAID acquisition funnel: GA4 + Meta
// Pixel, Ticket only. This is separate from PostHog (product analytics):
// these tags exist so ad platforms can see which ad spend produces real
// accounts, which they currently cannot (audit 2026-08-25: the measurable
// funnel ended at the marketing site's CTA click).
//
// The IDs are public identifiers, visible in any page's source, so they live
// in code rather than env vars. The boundary that matters is the HOST GATE:
// this app serves more than one brand, and brands never share tags, so the
// tags load only on *.getticket.ai hosts. Neat domains, Vercel previews, and
// localhost load nothing and fire nothing.
//
// Same IDs as the marketing site (ticket-marketing lib/analytics.ts), so a
// visitor keeps one GA4 client and one _fbp cookie across the
// www.getticket.ai -> app.getticket.ai handoff (first-party cookies on the
// shared root domain; no cross-domain linker needed).

export const TICKET_GA4_ID = "G-8NGYLJTS22"
export const TICKET_META_PIXEL_ID = "1845009833577136"

export function isTicketHost(): boolean {
  if (typeof window === "undefined") return false
  return /(^|\.)getticket\.ai$/.test(window.location.hostname)
}

// The two conversions the ad platforms optimize on. Meta gets its standard
// event names; GA4 gets the names Chris marks as key events in the GA4 UI.
type MarketingConversion = "CompleteRegistration" | "StartTrial"

const GA4_EVENT: Record<MarketingConversion, string> = {
  CompleteRegistration: "sign_up",
  StartTrial: "trial_activated",
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// The pixels load via next/script afterInteractive, so a conversion fired
// from a mount effect on the same page load can race them. fbq cannot be
// pre-stubbed (Meta's official loader early-returns if window.fbq already
// exists, which would stop fbevents.js from ever loading), so poll briefly
// and send when the tags are up. At the cap, send to whichever tag exists;
// with a blocker active that is a silent no-op, which is the correct outcome.
function sendWhenReady(name: MarketingConversion, tries = 0): void {
  const w = window as any
  const ready = typeof w.fbq === "function" && typeof w.gtag === "function"
  if (ready || tries >= 40) {
    try {
      w.fbq?.("track", name)
    } catch {
      /* tags must never break the product */
    }
    try {
      w.gtag?.("event", GA4_EVENT[name])
    } catch {
      /* tags must never break the product */
    }
    return
  }
  setTimeout(() => sendWhenReady(name, tries + 1), 500)
}

/** Fire a conversion at most once per browser (localStorage guard), and only
 *  on a Ticket production host. Safe to call from remounts, back-button
 *  replays, and refreshes. */
export function fireMarketingConversionOnce(name: MarketingConversion): void {
  if (!isTicketHost()) return
  const key = `ticket_mkt_${name}`
  try {
    if (window.localStorage.getItem(key)) return
    window.localStorage.setItem(key, new Date().toISOString())
  } catch {
    // Storage unavailable (private mode): fall through and fire anyway.
    // Worst case is a duplicate conversion, better than a missing one.
  }
  sendWhenReady(name)
}
