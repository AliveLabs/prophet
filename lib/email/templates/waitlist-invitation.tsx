import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface WaitlistInvitationProps {
  name?: string
  magicLinkUrl: string
  /**
   * "access": first time in, waitlist approved, or an admin created their account.
   * "signin": an EXISTING user was sent a fresh sign-in link.
   *
   * Defaults to "access" so existing callers keep their meaning.
   */
  variant?: "access" | "signin"
}

// Deliberately makes NO promise about a trial. Trial time starts when an org completes
// checkout or takes the card-less "skip for now" path, NOT when someone clicks a link in
// an email, so "your 14-day trial starts the moment you click below" was false for every
// sender. It's doubly wrong for an invited team member, who has no control over billing at
// all: the org's owner does. Billing state belongs in the app, where it's live and
// accurate, not baked into an email that might be read weeks later.
export function WaitlistInvitation({
  name,
  magicLinkUrl,
  variant = "access",
}: WaitlistInvitationProps) {
  const isSignin = variant === "signin"

  return (
    <EmailLayout
      preview={isSignin ? "Your Ticket sign-in link" : "Your Ticket dashboard is ready"}
    >
      <Section>
        <Text style={emailStyles.heading}>
          {isSignin
            ? "Here's your sign-in link"
            : name
              ? `Welcome, ${name}!`
              : "Welcome to Ticket!"}
        </Text>

        {isSignin ? (
          <Text style={emailStyles.paragraph}>
            Use the link below to sign in to Ticket. It only works once, so request a new
            one any time you need it.
          </Text>
        ) : (
          <>
            <Text style={emailStyles.paragraph}>
              Your account is ready. Ticket watches your local market and gives you a daily
              brief on what your competitors are doing, and what to do about it.
            </Text>
            <Text style={emailStyles.paragraph}>
              Sign in below to get started. If your restaurant isn&rsquo;t set up yet,
              we&rsquo;ll walk you through it in a couple of minutes.
            </Text>
          </>
        )}

        <Section style={emailStyles.ctaContainer}>
          <Link href={magicLinkUrl} style={emailStyles.ctaButton}>
            {isSignin ? "Sign in to Ticket" : "Get started"}
          </Link>
        </Section>

        <Text style={emailStyles.fallbackText}>
          Or copy and paste this link into your browser:{" "}
          <Link href={magicLinkUrl} style={emailStyles.inlineLink}>
            {magicLinkUrl}
          </Link>
        </Text>

        {/* No fixed duration claimed: link lifetime is an auth setting, and the old
            "expires in 24 hours" line was a guess that could easily be wrong. */}
        <Text style={emailStyles.paragraph}>
          This link is single use. If it stops working, go to the sign-in page and request a
          new one with your email address.
        </Text>

        <Text style={emailStyles.signoff}>The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
