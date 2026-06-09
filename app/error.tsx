"use client"

import "./chrome.css"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="ticket-chrome">
      <div className="chrome-card">
        <span className="chrome-kicker">Something broke</span>
        <h1 className="chrome-h">That didn&apos;t <em>go through</em>.</h1>
        <p className="chrome-sub">A hiccup on our end, not yours. Try again — and if it keeps happening, we&apos;re on it.</p>
        <div className="chrome-actions">
          <button className="chrome-btn" onClick={() => reset()}>Try again</button>
          <a className="chrome-btn chrome-btn--ghost" href="/home">Back to your brief</a>
        </div>
        {error?.digest ? <p className="chrome-foot">Reference · {error.digest}</p> : null}
      </div>
    </main>
  )
}
