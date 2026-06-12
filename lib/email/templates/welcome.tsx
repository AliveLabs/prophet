import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface VerticalEmailCopy {
  subject: string
  headline: string
  intro: string
  tipHeader: string
  tipBody: string
}

interface WelcomeProps {
  userName: string
  locationName: string
  competitorCount: number
  dashboardUrl: string
  verticalCopy?: VerticalEmailCopy
}

export function Welcome({
  userName,
  locationName,
  competitorCount,
  dashboardUrl,
  verticalCopy,
}: WelcomeProps) {
  const previewText = verticalCopy?.subject ?? "Welcome to Ticket — your feed is live"
  const tipText = verticalCopy?.tipBody ?? "Bookmark your dashboard so you can check it between the lunch and dinner rush."

  return (
    <EmailLayout preview={previewText}>
      <Section>
        <Text style={emailStyles.heading}>Welcome to Ticket, {userName}.</Text>
        <Text style={emailStyles.paragraph}>
          Your competitive intelligence is now live. Here&rsquo;s a quick recap
          of what we set up:
        </Text>

        <Section style={emailStyles.infoBox}>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Location:</strong>{" "}
            {locationName}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Competitors tracked:</strong>{" "}
            {competitorCount}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Monitoring:</strong> Active
          </Text>
        </Section>

        <Text style={emailStyles.heading2}>What happens now?</Text>
        <Text style={emailStyles.paragraph}>
          Ticket is already collecting data on your competitors. Within 24 hours,
          you&rsquo;ll start seeing your first insights. Check back in a week
          for your first weekly intelligence briefing — the 5 most important
          things happening in your local market.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={dashboardUrl} style={emailStyles.ctaButton}>
            Go to your dashboard
          </Link>
        </Section>

        <Text style={emailStyles.footnote}>
          Tip: {tipText}
        </Text>

        <Text style={emailStyles.signoff}>— The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
