import { Section, Text } from "@react-email/components"
import { EmailLayout } from "./layout"

interface WaitlistConfirmationProps {
  name?: string
}

export function WaitlistConfirmation({ name }: WaitlistConfirmationProps) {
  return (
    <EmailLayout preview="You're on the Ticket waitlist">
      <Section>
        <Text style={heading}>
          {name ? `Thanks, ${name}!` : "Thanks for signing up!"}
        </Text>
        <Text style={paragraph}>
          You&rsquo;re now on the Ticket waitlist. We&rsquo;re rolling out access
          in limited batches to ensure every customer gets the best possible
          experience.
        </Text>
        <Text style={paragraph}>
          When your spot is ready, we&rsquo;ll send you an email with everything
          you need to get started &mdash; including a link to set up your
          dashboard and begin monitoring your competitive landscape.
        </Text>
        <Text style={paragraph}>
          In the meantime, sit tight. We&rsquo;ll be in touch soon.
        </Text>
        <Text style={signoff}>&mdash; The Ticket Team</Text>
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

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
