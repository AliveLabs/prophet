import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

// Replaces the magic-link-only email. The code is the primary path because the
// paid-social audience reads this inside an in-app browser, where "click the
// button" means leaving the app and losing them; typing 6 digits on the page
// they came from does not. The link stays for everyone in a real browser.

interface SignInCodeEmailProps {
  email: string
  code: string
  magicLinkUrl: string
  mode: "signin" | "signup"
}

const codeStyle = {
  fontFamily: "'Space Mono', ui-monospace, Menlo, monospace",
  fontSize: "34px",
  fontWeight: 700,
  letterSpacing: "0.28em",
  textAlign: "center" as const,
  color: "#1C1917",
  backgroundColor: "#FFFFFF",
  border: "1px solid #DEDAD3",
  borderRadius: "6px",
  padding: "16px 8px 16px 16px",
  margin: "20px 0",
}

export function SignInCodeEmail({ email, code, magicLinkUrl, mode }: SignInCodeEmailProps) {
  const heading = mode === "signup" ? "Finish creating your account" : "Sign in to Ticket"
  return (
    <EmailLayout preview={`${code} is your code`}>
      <Section>
        <Text style={emailStyles.heading}>{heading}</Text>
        <Text style={emailStyles.paragraph}>
          Here is your code for{" "}
          <strong style={emailStyles.strongText}>{email}</strong>. Type it on
          the page where you requested it.
        </Text>

        <Text style={codeStyle}>{code}</Text>

        <Text style={emailStyles.paragraph}>
          Or, if it is easier, use this button:
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={magicLinkUrl} style={emailStyles.ctaButton}>
            {mode === "signup" ? "Create my account" : "Sign in to Ticket"}
          </Link>
        </Section>

        <Text style={emailStyles.paragraph}>
          The code and the button both expire in 1 hour. If you didn&rsquo;t
          request this, you can safely ignore this email.
        </Text>

        <Text style={emailStyles.signoff}>The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
