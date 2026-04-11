import { Section, Text, Link } from "@react-email/components"
import { EmailLayout } from "./layout"

interface WelcomeProps {
  userName: string
  locationName: string
  competitorCount: number
  dashboardUrl: string
}

export function Welcome({
  userName,
  locationName,
  competitorCount,
  dashboardUrl,
}: WelcomeProps) {
  return (
    <EmailLayout preview="Welcome to Vatic — your intelligence is live">
      <Section>
        <Text style={heading}>Welcome to Vatic, {userName}.</Text>
        <Text style={paragraph}>
          Your competitive intelligence is now live. Here&rsquo;s a quick recap
          of what we set up:
        </Text>

        <Section style={recapBox}>
          <Text style={recapItem}>
            <strong style={{ color: "#E4E4E7" }}>Location:</strong>{" "}
            {locationName}
          </Text>
          <Text style={recapItem}>
            <strong style={{ color: "#E4E4E7" }}>Competitors tracked:</strong>{" "}
            {competitorCount}
          </Text>
          <Text style={recapItem}>
            <strong style={{ color: "#E4E4E7" }}>Monitoring:</strong> Active
          </Text>
        </Section>

        <Text style={heading2}>What happens now?</Text>
        <Text style={paragraph}>
          Vatic is already collecting data on your competitors. Within 24 hours,
          you&rsquo;ll start seeing your first insights. Check back in a week
          for your first weekly intelligence briefing — the 5 most important
          things happening in your local market.
        </Text>

        <Section style={ctaContainer}>
          <Link href={dashboardUrl} style={ctaButton}>
            Go to your dashboard
          </Link>
        </Section>

        <Text style={tip}>
          Tip: Bookmark your dashboard so you can check it between the lunch and
          dinner rush.
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

const recapBox = {
  backgroundColor: "#2B353F",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "16px 0",
}

const recapItem = {
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

const tip = {
  fontSize: "13px",
  color: "#71717A",
  fontStyle: "italic" as const,
  margin: "0 0 12px",
}

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
