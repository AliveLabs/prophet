import Link from "next/link"
import { Suspense, type ReactNode } from "react"
import type { Metadata } from "next"
import { processUnsubscribeRequest } from "@/lib/marketing/unsubscribe-flow"
import "../chrome.css"

// D7 unsubscribe: the public landing for the signed links the lifecycle
// emails embed (contract: docs/UNSUBSCRIBE-CONTRACT.md). Unauthenticated by
// design: the recipient may have no session on this device, and the signature
// in the URL is the entire authorization.
//
// NON-ENUMERATION: any missing or invalid signature renders one neutral
// "invalid or expired" state, whether or not the address exists. Never vary
// the copy, status code, or storage work by contact existence.
//
// The opt-out is recorded on GET. Deliberate (decision D7): unsubscribing
// must be one click with no extra confirm step. The resubscribe affordance
// reverses it through the same signed params, so a link-prefetching mail
// scanner that trips it is recoverable by the recipient.
//
// cacheComponents pattern (canonical for this repo, see app/(dashboard)/layout.tsx):
// the exported page is sync with a 100% static Suspense fallback, and the
// async child does all the uncached work (searchParams + the storage write).

export const metadata: Metadata = {
  title: "Email preferences",
  robots: { index: false, follow: false },
}

type UnsubscribeSearchParams = { e?: string; s?: string; a?: string }

type UnsubscribePageProps = {
  searchParams?: Promise<UnsubscribeSearchParams>
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="ticket-chrome">
      <div className="chrome-card">
        <span className="chrome-kicker">Email preferences</span>
        {children}
        <p className="chrome-foot">Ticket · Competitive intelligence for restaurants</p>
      </div>
    </main>
  )
}

function Pending() {
  return (
    <Shell>
      <h1 className="chrome-h" aria-busy="true">
        One moment.
      </h1>
      <p className="chrome-sub">Updating your email preferences.</p>
    </Shell>
  )
}

async function UnsubscribeResult({
  searchParams,
}: {
  searchParams?: Promise<UnsubscribeSearchParams>
}) {
  const params = (await searchParams) ?? {}
  const outcome = await processUnsubscribeRequest(params)

  if (outcome.state === "unsubscribed") {
    return (
      <Shell>
        <h1 className="chrome-h">
          You&apos;re <em>unsubscribed</em>.
        </h1>
        <p className="chrome-sub">
          {outcome.email} will no longer receive marketing email from Ticket.
          Messages about your account, billing, and security are not affected.
        </p>
        <div className="chrome-actions">
          <Link className="chrome-btn" href="/">
            Back to Ticket
          </Link>
          <Link
            className="chrome-btn chrome-btn--ghost"
            href={outcome.resubscribeHref}
          >
            Resubscribe instead
          </Link>
        </div>
      </Shell>
    )
  }

  if (outcome.state === "resubscribed") {
    return (
      <Shell>
        <h1 className="chrome-h">
          You&apos;re back <em>on the list</em>.
        </h1>
        <p className="chrome-sub">
          {outcome.email} will receive marketing email from Ticket again. You
          can change this at any time from the link in any of our emails.
        </p>
        <div className="chrome-actions">
          <Link className="chrome-btn" href="/">
            Back to Ticket
          </Link>
          <Link
            className="chrome-btn chrome-btn--ghost"
            href={outcome.unsubscribeHref}
          >
            Unsubscribe
          </Link>
        </div>
      </Shell>
    )
  }

  if (outcome.state === "error") {
    return (
      <Shell>
        <h1 className="chrome-h">
          Something went <em>wrong</em>.
        </h1>
        <p className="chrome-sub">
          We could not update your email preferences just now. Please open the
          link again in a few minutes.
        </p>
        <div className="chrome-actions">
          <Link className="chrome-btn" href="/">
            Back to Ticket
          </Link>
        </div>
      </Shell>
    )
  }

  // "invalid" — the same neutral page for a missing, malformed, forged, or
  // unverifiable link. It reveals nothing about whether an address exists.
  return (
    <Shell>
      <h1 className="chrome-h">
        This link is <em>invalid</em> or expired.
      </h1>
      <p className="chrome-sub">
        If you were trying to change your email preferences, open the link from
        a recent email and try again.
      </p>
      <div className="chrome-actions">
        <Link className="chrome-btn" href="/">
          Back to Ticket
        </Link>
      </div>
    </Shell>
  )
}

export default function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  return (
    <Suspense fallback={<Pending />}>
      <UnsubscribeResult searchParams={searchParams} />
    </Suspense>
  )
}
