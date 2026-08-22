import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles, type EmailBrand } from "./layout"
import { stripAccents } from "@/lib/text/accents"

interface FirstBriefReadyProps {
  brand: EmailBrand
  userName: string | null
  locationName: string
  headline: string | null
  briefUrl: string
}

// Sent once, when a location's FIRST brief lands. The onboarding loading
// screen tells people they can close the tab and we'll email them; this is
// that email. Keep it short: one promise kept, one link.
export function FirstBriefReady({
  brand,
  userName,
  locationName,
  headline,
  briefUrl,
}: FirstBriefReadyProps) {
  const subject = userName
    ? `${userName}, your first ${brand} brief is ready`
    : `Your first ${brand} brief is ready`
  return (
    <EmailLayout preview={subject} brand={brand}>
      <Section>
        <Text style={emailStyles.heading}>Your first brief is ready.</Text>

        <Text style={emailStyles.paragraph}>
          {/* ALT-711: this asserted all six families had LANDED, regardless of what actually
              returned data. A location with no website gets no search visibility, and a quiet week
              returns no local events, so the list was a promise about the pass rather than a
              description of it. "We looked across" is true either way. */}
          We finished the first full intelligence pass for {locationName}. We looked
          across competitors, menus, search visibility, social, local events and
          weather, and distilled what came back into your brief.
        </Text>

        {headline ? (
          <Text style={emailStyles.pullQuote}>
            &ldquo;{stripAccents(headline)}&rdquo;
          </Text>
        ) : null}

        <Section style={emailStyles.ctaContainer}>
          <Link href={briefUrl} style={emailStyles.ctaButton}>
            Read your brief
          </Link>
        </Section>

        <Text style={emailStyles.paragraph}>
          {/* ALT-711: said "daily [...] each morning" to every recipient, including weekly
              Starter orgs, whose runCadence is "weekly". Naming the cadence would need the org's
              tier at this send site, which the brief pipeline context does not carry; this wording
              is true on both plans. */}
          From here, {brand} keeps watching, and your next brief will be waiting
          on your dashboard.
        </Text>

        <Text style={emailStyles.signoff}>The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}
