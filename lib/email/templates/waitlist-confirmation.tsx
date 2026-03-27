import { Section, Text } from "@react-email/components"
import { EmailLayout } from "./layout"

interface WaitlistConfirmationProps {
  email: string
}

export function WaitlistConfirmation({ email }: WaitlistConfirmationProps) {
  return (
    <EmailLayout preview="You're on the Vatic waitlist">
      <Section>
        <Text style={heading}>You&rsquo;re on the list.</Text>
        <Text style={paragraph}>
          Thanks for signing up for Vatic. We&rsquo;re building the competitive
          intelligence platform that restaurant operators actually want to use.
        </Text>
        <Text style={paragraph}>
          We registered <strong style={{ color: "#E4E4E7" }}>{email}</strong>{" "}
          for early access. When your spot opens, we&rsquo;ll send you
          everything you need to get started.
        </Text>
        <Text style={heading2}>What happens next?</Text>
        <Text style={paragraph}>
          We&rsquo;re onboarding new users in batches to make sure the
          experience is seamless. The first 500 signups get priority access and
          an exclusive launch discount.
        </Text>
        <Text style={paragraph}>
          In the meantime, sit tight. We&rsquo;ll be in touch soon.
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

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
