import { Section, Text } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface WaitlistDeclineProps {
  name?: string
}

export function WaitlistDecline({ name }: WaitlistDeclineProps) {
  return (
    <EmailLayout preview="Update on your Ticket waitlist request">
      <Section>
        <Text style={emailStyles.heading}>
          {name ? `Hi ${name},` : "Hi there,"}
        </Text>
        <Text style={emailStyles.paragraph}>
          Thank you for your interest in Ticket. We truly appreciate you taking
          the time to sign up.
        </Text>
        <Text style={emailStyles.paragraph}>
          We&rsquo;re currently rolling out access in limited batches to ensure
          each customer receives the attention and support they deserve.
          Unfortunately, we&rsquo;re not able to offer access at this time.
        </Text>
        <Text style={emailStyles.paragraph}>
          We&rsquo;ll keep you posted as availability opens up. You&rsquo;re
          welcome to reapply at any time through our website.
        </Text>
        <Text style={emailStyles.paragraph}>
          Thank you for your patience and understanding.
        </Text>
        <Text style={emailStyles.signoff}>&mdash; The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
