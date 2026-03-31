import { Section, Text } from "@react-email/components"
import { EmailLayout } from "./layout"

interface WaitlistDeclineProps {
  name?: string
}

export function WaitlistDecline({ name }: WaitlistDeclineProps) {
  return (
    <EmailLayout preview="Update on your Vatic waitlist request">
      <Section>
        <Text style={heading}>
          {name ? `Hi ${name},` : "Hi there,"}
        </Text>
        <Text style={paragraph}>
          Thank you for your interest in Vatic. We truly appreciate you taking
          the time to sign up.
        </Text>
        <Text style={paragraph}>
          We&rsquo;re currently rolling out access in limited batches to ensure
          each customer receives the attention and support they deserve.
          Unfortunately, we&rsquo;re not able to offer access at this time.
        </Text>
        <Text style={paragraph}>
          We&rsquo;ll keep you posted as availability opens up. You&rsquo;re
          welcome to reapply at any time through our website.
        </Text>
        <Text style={paragraph}>
          Thank you for your patience and understanding.
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

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
