import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface WaitlistInvitationProps {
  name?: string
  magicLinkUrl: string
}

export function WaitlistInvitation({
  name,
  magicLinkUrl,
}: WaitlistInvitationProps) {
  return (
    <EmailLayout preview="You're in! Your Ticket dashboard is ready">
      <Section>
        <Text style={emailStyles.heading}>
          {name ? `Welcome, ${name}!` : "Welcome to Ticket!"}
        </Text>
        <Text style={emailStyles.paragraph}>
          Great news &mdash; your spot is ready. You now have full access to
          your Ticket competitive intelligence dashboard.
        </Text>
        <Text style={emailStyles.paragraph}>
          Your <strong style={emailStyles.successText}>14-day free trial</strong>{" "}
          starts the moment you click below. During that time, you&rsquo;ll be
          able to set up your restaurant, discover competitors, and start
          receiving actionable insights.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={magicLinkUrl} style={emailStyles.ctaButton}>
            Access Your Dashboard
          </Link>
        </Section>

        <Text style={emailStyles.fallbackText}>
          Or copy and paste this link into your browser:{" "}
          <Link href={magicLinkUrl} style={emailStyles.inlineLink}>
            {magicLinkUrl}
          </Link>
        </Text>

        <Text style={emailStyles.paragraph}>
          This link expires in 24 hours. If it expires, visit our site and sign
          in with your email to get a new one.
        </Text>

        <Text style={emailStyles.signoff}>&mdash; The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
