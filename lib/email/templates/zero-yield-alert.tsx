import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface ZeroYieldLine {
  /** Human provider name, e.g. "Events". */
  label: string
  /** "zero" or "collapsed" — a total blackout reads differently from a shortfall. */
  status: string
  /** One actionable sentence, already composed by describeVerdict(). */
  detail: string
  consecutiveZeroDays: number
}

interface ZeroYieldAlertProps {
  lines: ZeroYieldLine[]
  /** True when any line is on its second-or-later consecutive night. Drives the louder headline. */
  escalated: boolean
  /** The day judged, so the reader knows which night this is about. */
  asOfDateKey: string
  dashboardUrl: string
}

/**
 * Internal OPS alert (clientFacing:false) for ALT-571: a data source returned a well-formed EMPTY
 * rather than an error, so nothing else in the system had anything to complain about.
 *
 * Deliberately a SEPARATE template from vendor-health-alert. That one says "the vendor is failing",
 * which is the wrong sentence here and would send someone to check an account status that is
 * perfectly fine. The 2026-08 blackout returned HTTP 200 with an empty list for five days.
 *
 * Every line is pre-composed by describeVerdict() so the email and the Slack message cannot drift
 * into describing the same verdict differently.
 */
export function ZeroYieldAlert({ lines, escalated, asOfDateKey, dashboardUrl }: ZeroYieldAlertProps) {
  const headline = escalated
    ? "A data source is still returning nothing"
    : "A data source returned nothing"

  return (
    <EmailLayout preview={`${headline} (${asOfDateKey})`}>
      <Section>
        <Text style={emailStyles.kicker}>
          OPS ALERT · UNEXPECTED ZERO{escalated ? " · ESCALATED" : ""}
        </Text>
        <Text style={emailStyles.heading}>{headline}</Text>
        <Text style={emailStyles.alertText}>
          These pulls SUCCEEDED and came back empty, so no vendor-failure alert would fire for them.
        </Text>

        {lines.map((l) => (
          <Text key={l.label} style={emailStyles.paragraph}>
            <strong style={emailStyles.strongText}>{l.label}:</strong> {l.detail}
          </Text>
        ))}

        <Text style={emailStyles.paragraph}>
          {escalated
            ? "This is not the first night. Treat it as an outage: check the vendor's status page and whether the account or endpoint has been paused, then confirm one location by hand."
            : "One night could be genuine. Confirm by checking a single location by hand before assuming a vendor problem."}
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={dashboardUrl} style={emailStyles.ctaButton}>
            Open dashboard
          </Link>
        </Section>

        <Text style={emailStyles.signoff}>Ticket zero-yield monitor</Text>
      </Section>
    </EmailLayout>
  )
}
