// Operator-facing "temporarily unavailable" banner — shown when a data source (DataForSEO)
// is currently failing for this location, so an outage reads as an honest heads-up instead of
// the silent "No data yet" empty state. Billing/credit details stay in the ops alert, not here.

export function VendorUnavailableBanner({
  source,
  asOf,
}: {
  /** What's unavailable, in the operator's words, e.g. "Local event data". */
  source: string
  /** date_key of the last good snapshot, if any, to reassure that data is preserved. */
  asOf?: string | null
}) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <p className="font-medium text-warning-dark">{source} is temporarily unavailable</p>
      <p className="mt-0.5 text-warning-dark/80">
        We couldn&rsquo;t reach our data source
        {asOf ? `, so you’re seeing your last good read from ${asOf}` : ""}. This usually clears on
        its own &mdash; your saved data is safe and we&rsquo;ll refresh automatically once it&rsquo;s back.
      </p>
    </div>
  )
}
