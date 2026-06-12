import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface TrialExpiringProps {
  userName: string
  daysLeft: number
  insightsGenerated: number
  upgradeUrl: string
}

export function TrialExpiring({
  userName,
  daysLeft,
  insightsGenerated,
  upgradeUrl,
}: TrialExpiringProps) {
  const isLastDay = daysLeft <= 1
  const subject = isLastDay
    ? "Last day of your Ticket trial"
    : `Your Ticket trial ends in ${daysLeft} days`

  return (
    <EmailLayout preview={subject}>
      <Section>
        <Text style={emailStyles.heading}>
          {isLastDay
            ? `${userName}, this is your last day.`
            : `${userName}, ${daysLeft} days left.`}
        </Text>

        <Text style={emailStyles.paragraph}>
          Your free trial of Ticket{" "}
          {isLastDay ? "expires today" : `ends in ${daysLeft} days`}. During
          your trial, Ticket generated{" "}
          <strong style={emailStyles.strongText}>
            {insightsGenerated} insights
          </strong>{" "}
          about your local market.
        </Text>

        <Text style={emailStyles.heading2}>What you&rsquo;ll lose access to:</Text>
        <Text style={emailStyles.listItem}>Daily competitor monitoring</Text>
        <Text style={emailStyles.listItem}>Weekly intelligence briefings</Text>
        <Text style={emailStyles.listItem}>SEO, social, and event tracking</Text>
        <Text style={emailStyles.listItem}>AI-powered recommendations</Text>

        <Text style={emailStyles.paragraph}>
          Your data won&rsquo;t be deleted — it&rsquo;ll be waiting for you if
          you upgrade.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={upgradeUrl} style={emailStyles.ctaButton}>
            Upgrade now
          </Link>
        </Section>

        <Text style={emailStyles.signoff}>— The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
