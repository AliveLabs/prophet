import { Section, Text, Link } from "@react-email/components"
import { EmailLayout } from "./layout"

interface WaitlistInvitationProps {
  name?: string
  magicLinkUrl: string
}

export function WaitlistInvitation({
  name,
  magicLinkUrl,
}: WaitlistInvitationProps) {
  return (
    <EmailLayout preview="You're in! Your Vatic dashboard is ready">
      <Section>
        <Text style={heading}>
          {name ? `Welcome, ${name}!` : "Welcome to Vatic!"}
        </Text>
        <Text style={paragraph}>
          Great news &mdash; your spot is ready. You now have full access to
          your Vatic competitive intelligence dashboard.
        </Text>
        <Text style={paragraph}>
          Your <strong style={{ color: "#E4E4E7" }}>14-day free trial</strong>{" "}
          starts the moment you click below. During that time, you&rsquo;ll be
          able to set up your restaurant, discover competitors, and start
          receiving actionable insights.
        </Text>

        <Section style={ctaContainer}>
          <Link href={magicLinkUrl} style={ctaButton}>
            Access Your Dashboard
          </Link>
        </Section>

        <Text style={fallback}>
          Or copy and paste this link into your browser:{" "}
          <Link href={magicLinkUrl} style={fallbackLink}>
            {magicLinkUrl}
          </Link>
        </Text>

        <Text style={paragraph}>
          This link expires in 24 hours. If it expires, visit our site and sign
          in with your email to get a new one.
        </Text>

        <Text style={signoff}>&mdash; The Vatic Team</Text>
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

const ctaContainer = {
  textAlign: "center" as const,
  margin: "28px 0",
}

const ctaButton = {
  backgroundColor: "#FF7849",
  color: "#FFFFFF",
  padding: "14px 36px",
  borderRadius: "8px",
  fontSize: "16px",
  fontWeight: "600" as const,
  textDecoration: "none",
  display: "inline-block",
}

const fallback = {
  fontSize: "12px",
  lineHeight: "1.5",
  color: "#71717A",
  margin: "0 0 16px",
  wordBreak: "break-all" as const,
}

const fallbackLink = {
  color: "#34775E",
  textDecoration: "underline",
}

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
