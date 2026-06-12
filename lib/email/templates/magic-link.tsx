import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface MagicLinkEmailProps {
  email: string
  magicLinkUrl: string
}

export function MagicLinkEmail({ email, magicLinkUrl }: MagicLinkEmailProps) {
  return (
    <EmailLayout preview="Your Ticket sign-in link">
      <Section>
        <Text style={emailStyles.heading}>Sign in to Ticket</Text>
        <Text style={emailStyles.paragraph}>
          We received a sign-in request for{" "}
          <strong style={emailStyles.strongText}>{email}</strong>. Click the
          button below to continue.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={magicLinkUrl} style={emailStyles.ctaButton}>
            Sign in to Ticket
          </Link>
        </Section>

        <Text style={emailStyles.fallbackText}>
          Or copy and paste this link into your browser:{" "}
          <Link href={magicLinkUrl} style={emailStyles.inlineLink}>
            {magicLinkUrl}
          </Link>
        </Text>

        <Text style={emailStyles.paragraph}>
          This link expires in 1 hour. If you didn&rsquo;t request this, you
          can safely ignore this email.
        </Text>

        <Text style={emailStyles.signoff}>&mdash; The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
