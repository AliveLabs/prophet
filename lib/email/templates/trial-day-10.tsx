import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles, type EmailBrand } from "./layout"

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
        <Text style={emailStyles.heading}>{userName}, 4 days left in your trial.</Text>

        <Text style={emailStyles.paragraph}>
          You&rsquo;re 10 days into your {brand} {tierDisplayName} trial. In 4
          days your card will be charged and your subscription continues
          uninterrupted. No action needed if you want to keep going.
        </Text>

        <Text style={emailStyles.heading2}>What&rsquo;s working so far</Text>
        <Text style={emailStyles.listItem}>• Daily competitor briefings</Text>
        <Text style={emailStyles.listItem}>• Menu + pricing change alerts</Text>
        <Text style={emailStyles.listItem}>
          • SEO tracking across your top keywords
        </Text>
        <Text style={emailStyles.listItem}>• Social media signal monitoring</Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={portalUrl} style={emailStyles.ctaButton}>
            Manage subscription
          </Link>
        </Section>

        <Text style={emailStyles.paragraph}>
          If {brand} isn&rsquo;t a fit,{" "}
          <Link href={cancelUrl} style={emailStyles.inlineLink}>
            cancel anytime
          </Link>{" "}
          — we won&rsquo;t charge you a cent.
        </Text>

        <Text style={emailStyles.signoff}>— The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}
