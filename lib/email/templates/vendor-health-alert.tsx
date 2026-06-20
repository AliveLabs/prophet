import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface VendorHealthAlertProps {
  /** Human vendor name, e.g. "DataForSEO". */
  vendor: string
  /** True when the failure is "account out of credits" (refill needed). */
  paymentRequired: boolean
  downLocations: number
  totalLocations: number
  /** A sample failure reason captured from a recent run (for context). */
  sampleReason?: string
  /** Where to go to look (admin / dashboard). */
  dashboardUrl: string
}

/**
 * Internal OPS alert (clientFacing:false) — fires when a data vendor goes down fleet-wide.
 * Built for DataForSEO's 402 "out of credits" outage; reuses emailStyles.alertText for the red.
 */
export function VendorHealthAlert({
  vendor,
  paymentRequired,
  downLocations,
  totalLocations,
  sampleReason,
  dashboardUrl,
}: VendorHealthAlertProps) {
  const headline = paymentRequired
    ? `${vendor} is out of credits`
    : `${vendor} data source is failing`
  const action = paymentRequired
    ? `Refill the ${vendor} account to restore events + search-visibility pulls. Until then, briefs keep building on the last good data and the coverage pages show "temporarily unavailable".`
    : `${vendor} pulls are failing across the fleet. Check the vendor status / account, then re-run the affected pulls.`

  return (
    <EmailLayout preview={`${headline} — ${downLocations}/${totalLocations} locations affected`}>
      <Section>
        <Text style={emailStyles.kicker}>OPS ALERT · VENDOR HEALTH</Text>
        <Text style={emailStyles.heading}>{headline}</Text>
        <Text style={emailStyles.alertText}>
          {downLocations} of {totalLocations} active location{totalLocations === 1 ? "" : "s"} have
          failing {vendor} pulls (events / search visibility).
        </Text>
        <Text style={emailStyles.paragraph}>{action}</Text>
        {sampleReason ? (
          <Text style={emailStyles.paragraph}>
            <strong style={emailStyles.strongText}>Sample failure:</strong> {sampleReason.slice(0, 240)}
          </Text>
        ) : null}

        <Section style={emailStyles.ctaContainer}>
          <Link href={dashboardUrl} style={emailStyles.ctaButton}>
            Open dashboard
          </Link>
        </Section>

        <Text style={emailStyles.signoff}>— Ticket vendor-health monitor</Text>
      </Section>
    </EmailLayout>
  )
}
