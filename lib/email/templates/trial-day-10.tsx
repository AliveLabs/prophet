import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles, type EmailBrand } from "./layout"

interface TrialDay10Props {
  brand: EmailBrand
  userName: string
  tierDisplayName: string
  portalUrl: string
  cancelUrl: string
  /**
   * True when a card is on file and Stripe will charge it at trial end. False for
   * card-less trials ("skip for now"), where nothing is charged and the trial simply
   * ends unless they add a card — promising a charge there would be false.
   */
  hasCard?: boolean
}

// Day 10 of a mid-tier trial: T minus 4 days. The goal is encouragement +
// showing value, not a hard sell. Day 13 is the last-chance nudge.
export function TrialDay10({
  brand,
  userName,
  tierDisplayName,
  portalUrl,
  cancelUrl,
  hasCard = true,
}: TrialDay10Props) {
  const subject = `${userName}, 4 days left in your ${brand} trial`
  return (
    <EmailLayout preview={subject} brand={brand}>
      <Section>
        <Text style={emailStyles.heading}>{userName}, 4 days left in your trial.</Text>

        <Text style={emailStyles.paragraph}>
          {hasCard ? (
            <>
              You&rsquo;re 10 days into your {brand} {tierDisplayName} trial. In 4
              days your card will be charged and your subscription continues
              uninterrupted. No action needed if you want to keep going.
            </>
          ) : (
            <>
              You&rsquo;re 10 days into your {brand} {tierDisplayName} trial. In 4
              days it ends — there&rsquo;s no card on file, so nothing will be
              charged and your briefs will simply stop. Add a card to keep them
              coming.
            </>
          )}
        </Text>

        <Text style={emailStyles.heading2}>What&rsquo;s working so far</Text>
        <Text style={emailStyles.listItem}>• Daily competitor briefings</Text>
        <Text style={emailStyles.listItem}>• Menu + pricing change alerts</Text>
        <Text style={emailStyles.listItem}>
          • SEO tracking across your top keywords
        </Text>
        <Text style={emailStyles.listItem}>• Social media signal monitoring</Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={portalUrl} style={emailStyles.ctaButton}>
            {hasCard ? "Manage subscription" : "Add a card"}
          </Link>
        </Section>

        {hasCard ? (
          <Text style={emailStyles.paragraph}>
            If {brand} isn&rsquo;t a fit,{" "}
            <Link href={cancelUrl} style={emailStyles.inlineLink}>
              cancel anytime
            </Link>{" "}
            — we won&rsquo;t charge you a cent.
          </Text>
        ) : (
          <Text style={emailStyles.paragraph}>
            If {brand} isn&rsquo;t a fit, do nothing — the trial ends on its own and
            you&rsquo;re never charged.
          </Text>
        )}

        <Text style={emailStyles.signoff}>— The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}
