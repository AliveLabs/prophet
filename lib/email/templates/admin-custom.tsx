import { Section, Text } from "@react-email/components"
import { EmailLayout } from "./layout"

interface AdminCustomEmailProps {
  subject: string
  body: string
}

export function AdminCustomEmail({ subject, body }: AdminCustomEmailProps) {
  return (
    <EmailLayout preview={subject}>
      <Section>
        <Text style={heading}>{subject}</Text>
        <Text style={paragraph}>{body}</Text>
        <Text style={signoff}>&mdash; The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}

const heading = {
  fontSize: "24px",
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
  whiteSpace: "pre-wrap" as const,
}

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
