import { Section, Text } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface BillingEmailChangeNoticeProps {
  newEmail: string
}

/** Security notice only — sent to the CURRENT billing email when a change is
 *  requested. Informational; the change itself only takes effect once the
 *  new address is confirmed via BillingEmailVerification. */
export function BillingEmailChangeNotice({ newEmail }: BillingEmailChangeNoticeProps) {
  return (
    <EmailLayout preview="A billing email change was requested">
      <Section>
        <Text style={emailStyles.heading}>Billing email change requested</Text>
        <Text style={emailStyles.paragraph}>
          Someone on your account requested changing the billing email to{" "}
          <strong style={emailStyles.strongText}>{newEmail}</strong>. This
          email stays the billing contact unless that address is confirmed.
        </Text>
        <Text style={emailStyles.paragraph}>
          If you didn&rsquo;t request this, no action is needed — nothing
          changes unless the new address is verified. If you&rsquo;re
          concerned about account access, contact support.
        </Text>
        <Text style={emailStyles.signoff}>&mdash; The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
