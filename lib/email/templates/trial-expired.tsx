import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface TrialExpiredProps {
  userName: string
  upgradeUrl: string
}

export function TrialExpired({ userName, upgradeUrl }: TrialExpiredProps) {
  return (
    <EmailLayout preview="Your Ticket trial has ended">
      <Section>
        <Text style={emailStyles.heading}>Your trial has ended, {userName}.</Text>

        <Text style={emailStyles.paragraph}>
          Your free Ticket trial has expired. Here&rsquo;s what that means:
        </Text>

        <Section style={emailStyles.infoBox}>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Intelligence:</strong> Paused
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Your data:</strong> Safely
            stored for 30 days
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Competitors:</strong> No longer
            being monitored
          </Text>
        </Section>

        <Text style={emailStyles.paragraph}>
          Nothing has been deleted. Your insights, competitor data, and settings
          are all still there. Upgrade to any plan to resume monitoring
          instantly.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={upgradeUrl} style={emailStyles.ctaButton}>
            Upgrade to resume
          </Link>
        </Section>

        <Text style={emailStyles.mutedText}>
          Questions? Reply to this email — we read every response.
        </Text>

        <Text style={emailStyles.signoff}>— The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
