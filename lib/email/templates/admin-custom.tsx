import { Section, Text } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface AdminCustomEmailProps {
  subject: string
  body: string
}

export function AdminCustomEmail({ subject, body }: AdminCustomEmailProps) {
  return (
    <EmailLayout preview={subject}>
      <Section>
        <Text style={emailStyles.heading}>{subject}</Text>
        <Text style={emailStyles.paragraphPreWrap}>{body}</Text>
        <Text style={emailStyles.signoff}>&mdash; The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
