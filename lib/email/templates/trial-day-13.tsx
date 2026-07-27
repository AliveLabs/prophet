import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles, type EmailBrand } from "./layout"

interface TrialDay13Props {
  brand: EmailBrand
  userName: string
  tierDisplayName: string
  portalUrl: string
  cancelUrl: string
  /**
   * True when a card is on file and Stripe will charge it at trial end. False for
   * card-less trials ("skip for now"): nothing is charged, so this is a last chance to
   * KEEP the service rather than a last chance to cancel.
   */
  hasCard?: boolean
}

// Day 13 of a mid-tier trial: T minus 1 day. Last chance to cancel before
// the card is charged.
export function TrialDay13({
  brand,
  userName,
  tierDisplayName,
  portalUrl,
  cancelUrl,
  hasCard = true,
}: TrialDay13Props) {
  const subject = `${userName}, tomorrow your ${brand} trial ends`
  return (
    <EmailLayout preview={subject} brand={brand}>
      <Section>
        <Text style={emailStyles.heading}>Tomorrow your trial ends.</Text>

        <Text style={emailStyles.paragraph}>
          {hasCard ? (
            <>
              Hey {userName} — tomorrow your card will be charged for the{" "}
              {tierDisplayName} plan. If you want to stay on {brand}, you&rsquo;re
              all set. If it&rsquo;s not working out, you have one more day to
              cancel.
            </>
          ) : (
            <>
              Hey {userName} — tomorrow your {tierDisplayName} trial ends. There&rsquo;s
              no card on file, so you won&rsquo;t be charged anything: your briefs
              just stop. Add a card today to keep them running without a gap.
            </>
          )}
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={portalUrl} style={emailStyles.ctaButton}>
            {hasCard ? "Manage subscription" : "Add a card to keep going"}
          </Link>
        </Section>

        {hasCard ? (
          <Text style={emailStyles.paragraph}>
            Need to cancel?{" "}
            <Link href={cancelUrl} style={emailStyles.inlineLink}>
              Click here
            </Link>{" "}
            — no questions asked, your data stays available for 30 days in case
            you change your mind.
          </Text>
        ) : (
          <Text style={emailStyles.paragraph}>
            Not for you? Nothing happens — you&rsquo;re never charged, and your data
            stays available for 30 days in case you change your mind.
          </Text>
        )}

        <Text style={emailStyles.signoff}>— The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}
