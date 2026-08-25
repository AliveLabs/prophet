"use client"

import { useSyncExternalStore } from "react"
import Script from "next/script"
import {
  TICKET_GA4_ID,
  TICKET_META_PIXEL_ID,
  isTicketHost,
} from "@/lib/analytics/marketing-tags"

// GA4 + Meta Pixel for the paid acquisition funnel, mirroring the marketing
// site's Analytics component (ticket-marketing components/Analytics.tsx) so
// both halves of the getticket.ai funnel report to the same properties.
//
// Host-gated at runtime because this deployment serves more than one brand:
// the tags render only on *.getticket.ai (see lib/analytics/marketing-tags).
// The gate needs window, so the decision happens after mount; until then this
// renders nothing, and on non-Ticket hosts it renders nothing forever.
//
// GA4 here counts the initial page load per visit, which is enough for
// source attribution and the conversion events; per-route SPA pageviews stay
// PostHog's job. No noscript beacon: this component is itself JS-gated, so a
// noscript fallback could never render.
// The host never changes within a page's lifetime, so the "store" never
// notifies; useSyncExternalStore just gives us an SSR-safe read (false on the
// server, the real answer on the client) without a setState-in-effect.
const subscribeNever = () => () => {}

export default function MarketingPixels() {
  const enabled = useSyncExternalStore(
    subscribeNever,
    isTicketHost,
    () => false
  )

  if (!enabled) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${TICKET_GA4_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ticket-google-tag" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${TICKET_GA4_ID}');`}
      </Script>
      <Script id="ticket-meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${TICKET_META_PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
    </>
  )
}
