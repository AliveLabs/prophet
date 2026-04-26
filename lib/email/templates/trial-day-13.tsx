import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, type EmailBrand } from "./layout"

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
        <Text style={heading}>Tomorrow your trial ends.</Text>

        <Text style={paragraph}>
          Hey {userName} — tomorrow your card will be charged for the{" "}
          {tierDisplayName} plan. If you want to stay on {brand}, you&rsquo;re
          all set. If it&rsquo;s not working out, you have one more day to
          cancel.
        </Text>

        <Section style={ctaContainer}>
          <Link href={portalUrl} style={ctaButton}>
            Manage subscription
          </Link>
        </Section>

        <Text style={paragraph}>
          Need to cancel?{" "}
          <Link href={cancelUrl} style={inlineLink}>
            Click here
          </Link>{" "}
          — no questions asked, your data stays available for 30 days in case
          you change your mind.
        </Text>

        <Text style={signoff}>— The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}

const heading = {
  fontSize: "28px",
  fontWeight: "700" as const,
  color: "#E4E4E7",
  lineHeight: "1.3",
  margin: "0 0 16px",
}
const paragraph = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: "#A1A1AA",
  margin: "0 0 12px",
}
const ctaContainer = {
  textAlign: "center" as const,
  margin: "28px 0",
}
const ctaButton = {
  backgroundColor: "#FF7849",
  color: "#FFFFFF",
  padding: "12px 32px",
  borderRadius: "8px",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  display: "inline-block",
}
const inlineLink = {
  color: "#FF7849",
  textDecoration: "underline",
}
const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
