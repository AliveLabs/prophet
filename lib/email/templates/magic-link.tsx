import { Section, Text, Link } from "@react-email/components"
import { EmailLayout } from "./layout"

interface MagicLinkEmailProps {
  email: string
  magicLinkUrl: string
}

export function MagicLinkEmail({ email, magicLinkUrl }: MagicLinkEmailProps) {
  return (
    <EmailLayout preview="Your Vatic sign-in link">
      <Section>
        <Text style={heading}>Sign in to Vatic</Text>
        <Text style={paragraph}>
          We received a sign-in request for{" "}
          <strong style={{ color: "#E4E4E7" }}>{email}</strong>. Click the
          button below to continue.
        </Text>

        <Section style={ctaContainer}>
          <Link href={magicLinkUrl} style={ctaButton}>
            Sign in to Vatic
          </Link>
        </Section>

        <Text style={fallback}>
          Or copy and paste this link into your browser:{" "}
          <Link href={magicLinkUrl} style={fallbackLink}>
            {magicLinkUrl}
          </Link>
        </Text>

        <Text style={paragraph}>
          This link expires in 1 hour. If you didn&rsquo;t request this, you
          can safely ignore this email.
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
  backgroundColor: "#00BFA6",
  color: "#FFFFFF",
  padding: "12px 32px",
  borderRadius: "8px",
  fontSize: "15px",
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
  color: "#00BFA6",
  textDecoration: "underline",
}

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
