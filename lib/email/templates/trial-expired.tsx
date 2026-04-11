import { Section, Text, Link } from "@react-email/components"
import { EmailLayout } from "./layout"

interface TrialExpiredProps {
  userName: string
  upgradeUrl: string
}

export function TrialExpired({ userName, upgradeUrl }: TrialExpiredProps) {
  return (
    <EmailLayout preview="Your Vatic trial has ended">
      <Section>
        <Text style={heading}>Your trial has ended, {userName}.</Text>

        <Text style={paragraph}>
          Your free Vatic trial has expired. Here&rsquo;s what that means:
        </Text>

        <Section style={statusBox}>
          <Text style={statusItem}>
            <strong style={{ color: "#E4E4E7" }}>Intelligence:</strong> Paused
          </Text>
          <Text style={statusItem}>
            <strong style={{ color: "#E4E4E7" }}>Your data:</strong> Safely
            stored for 30 days
          </Text>
          <Text style={statusItem}>
            <strong style={{ color: "#E4E4E7" }}>Competitors:</strong> No longer
            being monitored
          </Text>
        </Section>

        <Text style={paragraph}>
          Nothing has been deleted. Your insights, competitor data, and settings
          are all still there. Upgrade to any plan to resume monitoring
          instantly.
        </Text>

        <Section style={ctaContainer}>
          <Link href={upgradeUrl} style={ctaButton}>
            Upgrade to resume
          </Link>
        </Section>

        <Text style={muted}>
          Questions? Reply to this email — we read every response.
        </Text>

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

const paragraph = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: "#A1A1AA",
  margin: "0 0 12px",
}

const statusBox = {
  backgroundColor: "#2B353F",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "16px 0",
}

const statusItem = {
  fontSize: "14px",
  color: "#A1A1AA",
  margin: "4px 0",
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

const muted = {
  fontSize: "13px",
  color: "#71717A",
  margin: "0 0 12px",
}

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
