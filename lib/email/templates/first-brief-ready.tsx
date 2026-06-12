import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, type EmailBrand } from "./layout"

interface FirstBriefReadyProps {
  brand: EmailBrand
  userName: string
  locationName: string
  headline: string | null
  briefUrl: string
}

// Sent once, when a location's FIRST brief lands. The onboarding loading
// screen tells people they can close the tab and we'll email them — this is
// that email. Keep it short: one promise kept, one link.
export function FirstBriefReady({
  brand,
  userName,
  locationName,
  headline,
  briefUrl,
}: FirstBriefReadyProps) {
  const subject = `${userName}, your first ${brand} brief is ready`
  return (
    <EmailLayout preview={subject} brand={brand}>
      <Section>
        <Text style={heading}>Your first brief is ready.</Text>

        <Text style={paragraph}>
          We finished the first full intelligence pass for {locationName} —
          competitors, menus, search visibility, social, local events, and
          weather, distilled into your daily brief.
        </Text>

        {headline ? (
          <Text style={headlinePull}>&ldquo;{headline}&rdquo;</Text>
        ) : null}

        <Section style={ctaContainer}>
          <Link href={briefUrl} style={ctaButton}>
            Read your brief
          </Link>
        </Section>

        <Text style={paragraph}>
          From here, {brand} refreshes your signals daily and a new brief is
          waiting each morning.
        </Text>

        <Text style={signoff}>— The {brand} Team</Text>
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
const headlinePull = {
  fontSize: "18px",
  fontWeight: "600" as const,
  color: "#E4E4E7",
  lineHeight: "1.5",
  margin: "20px 0",
  paddingLeft: "14px",
  borderLeft: "3px solid #FF7849",
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
const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
