import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, type EmailBrand } from "./layout"

interface TrialDay10Props {
  brand: EmailBrand
  userName: string
  tierDisplayName: string
  portalUrl: string
  cancelUrl: string
}

// Day 10 of a mid-tier trial: T minus 4 days. The goal is encouragement +
// showing value, not a hard sell. Day 13 is the last-chance nudge.
export function TrialDay10({
  brand,
  userName,
  tierDisplayName,
  portalUrl,
  cancelUrl,
}: TrialDay10Props) {
  const subject = `${userName}, 4 days left in your ${brand} trial`
  return (
    <EmailLayout preview={subject} brand={brand}>
      <Section>
        <Text style={heading}>{userName}, 4 days left in your trial.</Text>

        <Text style={paragraph}>
          You&rsquo;re 10 days into your {brand} {tierDisplayName} trial. In 4
          days your card will be charged and your subscription continues
          uninterrupted. No action needed if you want to keep going.
        </Text>

        <Text style={heading2}>What&rsquo;s working so far</Text>
        <Text style={listItem}>• Daily competitor briefings</Text>
        <Text style={listItem}>• Menu + pricing change alerts</Text>
        <Text style={listItem}>
          • SEO tracking across your top keywords
        </Text>
        <Text style={listItem}>• Social media signal monitoring</Text>

        <Section style={ctaContainer}>
          <Link href={portalUrl} style={ctaButton}>
            Manage subscription
          </Link>
        </Section>

        <Text style={paragraph}>
          If {brand} isn&rsquo;t a fit,{" "}
          <Link href={cancelUrl} style={inlineLink}>
            cancel anytime
          </Link>{" "}
          — we won&rsquo;t charge you a cent.
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
const heading2 = {
  fontSize: "18px",
  fontWeight: "600" as const,
  color: "#E4E4E7",
  margin: "24px 0 8px",
}
const paragraph = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: "#A1A1AA",
  margin: "0 0 12px",
}
const listItem = {
  fontSize: "14px",
  color: "#A1A1AA",
  margin: "4px 0",
  paddingLeft: "12px",
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
