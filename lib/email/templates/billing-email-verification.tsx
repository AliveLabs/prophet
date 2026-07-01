import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface BillingEmailVerificationProps {
  verifyUrl: string
}

export function BillingEmailVerification({ verifyUrl }: BillingEmailVerificationProps) {
  return (
    <EmailLayout preview="Confirm your billing email">
      <Section>
        <Text style={emailStyles.heading}>Confirm your billing email</Text>
        <Text style={emailStyles.paragraph}>
          Someone requested this address as the new billing email for a Ticket
          account. Click below to confirm — nothing changes until you do.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={verifyUrl} style={emailStyles.ctaButton}>
            Confirm billing email
          </Link>
        </Section>

        <Text style={emailStyles.fallbackText}>
          Or copy and paste this link into your browser:{" "}
          <Link href={verifyUrl} style={emailStyles.inlineLink}>
            {verifyUrl}
          </Link>
        </Text>

        <Text style={emailStyles.paragraph}>
          This link expires in 24 hours and can only be used once. If you
          didn&rsquo;t request this, you can safely ignore this email — your
          billing email will not change.
        </Text>

        <Text style={emailStyles.signoff}>&mdash; The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
