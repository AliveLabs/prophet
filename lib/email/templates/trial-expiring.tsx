import { Section, Text, Link } from "@react-email/components"
import { EmailLayout } from "./layout"

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
    ? "Last day of your Vatic trial"
    : `Your Vatic trial ends in ${daysLeft} days`

  return (
    <EmailLayout preview={subject}>
      <Section>
        <Text style={heading}>
          {isLastDay
            ? `${userName}, this is your last day.`
            : `${userName}, ${daysLeft} days left.`}
        </Text>

        <Text style={paragraph}>
          Your free trial of Vatic{" "}
          {isLastDay ? "expires today" : `ends in ${daysLeft} days`}. During
          your trial, Vatic generated{" "}
          <strong style={{ color: "#E4E4E7" }}>
            {insightsGenerated} insights
          </strong>{" "}
          about your local market.
        </Text>

        <Text style={heading2}>What you&rsquo;ll lose access to:</Text>
        <Text style={listItem}>Daily competitor monitoring</Text>
        <Text style={listItem}>Weekly intelligence briefings</Text>
        <Text style={listItem}>SEO, social, and event tracking</Text>
        <Text style={listItem}>AI-powered recommendations</Text>

        <Text style={paragraph}>
          Your data won&rsquo;t be deleted — it&rsquo;ll be waiting for you if
          you upgrade.
        </Text>

        <Section style={ctaContainer}>
          <Link href={upgradeUrl} style={ctaButton}>
            Upgrade now
          </Link>
        </Section>

        <Text style={signoff}>— The Vatic Team</Text>
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
  backgroundColor: "#00BFA6",
  color: "#FFFFFF",
  padding: "12px 32px",
  borderRadius: "8px",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  display: "inline-block",
}

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
