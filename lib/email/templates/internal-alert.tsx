import { Section, Text } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface InternalAlertProps {
  heading: string
  /** One paragraph per entry. Plain text; keep it factual. */
  lines: string[]
}

/**
 * Minimal internal ops notification (never client-facing). Used by the signup
 * collision flows (access-request escalation, demo-org collision) alongside the
 * Slack webhook, mirroring vendor-health's "page ops on both channels" pattern:
 * Slack is best-effort and env-gated, so anything a human must act on also lands
 * in the ops inbox.
 */
export function InternalAlert({ heading, lines }: InternalAlertProps) {
  return (
    <EmailLayout preview={heading}>
      <Section>
        <Text style={emailStyles.heading}>{heading}</Text>
        {lines.map((line, i) => (
          <Text key={i} style={emailStyles.paragraph}>
            {line}
          </Text>
        ))}
        <Text style={emailStyles.footnote}>
          Internal notification from the Ticket app. Do not forward to customers.
        </Text>
      </Section>
    </EmailLayout>
  )
}
