"use client"

// Catches errors in the root layout itself — must render its own <html>/<body>.
import "./chrome.css"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="ticket-chrome">
          <div className="chrome-card">
            <span className="chrome-kicker">Something broke</span>
            <h1 className="chrome-h">That didn&apos;t <em>go through</em>.</h1>
            <p className="chrome-sub">A hiccup on our end. Try again in a moment.</p>
            <div className="chrome-actions">
              <button className="chrome-btn" onClick={() => reset()}>Try again</button>
            </div>
            {error?.digest ? <p className="chrome-foot">Reference · {error.digest}</p> : null}
          </div>
        </main>
      </body>
    </html>
  )
}
