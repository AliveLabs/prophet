import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles, type EmailBrand } from "./layout"

interface TrialDay13Props {
  brand: EmailBrand
  userName: string
  tierDisplayName: string
  portalUrl: string
  cancelUrl: string
}

// Day 13 of a mid-tier trial: T minus 1 day. Last chance to cancel before
// the card is charged.
export function TrialDay13({
  brand,
  userName,
  tierDisplayName,
  portalUrl,
  cancelUrl,
}: TrialDay13Props) {
  const subject = `${userName}, tomorrow your ${brand} trial ends`
  return (
    <EmailLayout preview={subject} brand={brand}>
      <Section>
        <Text style={emailStyles.heading}>Tomorrow your trial ends.</Text>

        <Text style={emailStyles.paragraph}>
          Hey {userName} — tomorrow your card will be charged for the{" "}
          {tierDisplayName} plan. If you want to stay on {brand}, you&rsquo;re
          all set. If it&rsquo;s not working out, you have one more day to
          cancel.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={portalUrl} style={emailStyles.ctaButton}>
            Manage subscription
          </Link>
        </Section>

        <Text style={emailStyles.paragraph}>
          Need to cancel?{" "}
          <Link href={cancelUrl} style={emailStyles.inlineLink}>
            Click here
          </Link>{" "}
          — no questions asked, your data stays available for 30 days in case
          you change your mind.
        </Text>

        <Text style={emailStyles.signoff}>— The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}
