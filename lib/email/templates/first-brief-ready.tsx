import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles, type EmailBrand } from "./layout"

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
        <Text style={emailStyles.heading}>Your first brief is ready.</Text>

        <Text style={emailStyles.paragraph}>
          We finished the first full intelligence pass for {locationName} —
          competitors, menus, search visibility, social, local events, and
          weather, distilled into your daily brief.
        </Text>

        {headline ? (
          <Text style={emailStyles.pullQuote}>&ldquo;{headline}&rdquo;</Text>
        ) : null}

        <Section style={emailStyles.ctaContainer}>
          <Link href={briefUrl} style={emailStyles.ctaButton}>
            Read your brief
          </Link>
        </Section>

        <Text style={emailStyles.paragraph}>
          From here, {brand} refreshes your signals daily and a new brief is
          waiting each morning.
        </Text>

        <Text style={emailStyles.signoff}>— The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}
