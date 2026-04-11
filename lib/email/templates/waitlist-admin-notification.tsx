import { Section, Text, Link } from "@react-email/components"
import { EmailLayout } from "./layout"

interface WaitlistAdminNotificationProps {
  signupEmail: string
  signupName?: string
  adminDashboardUrl: string
}

export function WaitlistAdminNotification({
  signupEmail,
  signupName,
  adminDashboardUrl,
}: WaitlistAdminNotificationProps) {
  return (
    <EmailLayout preview={`New waitlist signup: ${signupEmail}`}>
      <Section>
        <Text style={heading}>New Waitlist Signup</Text>
        <Text style={paragraph}>
          {signupName ? (
            <>
              <strong style={{ color: "#E4E4E7" }}>{signupName}</strong> (
              {signupEmail}) just joined the Vatic waitlist.
            </>
          ) : (
            <>
              <strong style={{ color: "#E4E4E7" }}>{signupEmail}</strong> just
              joined the Vatic waitlist.
            </>
          )}
        </Text>
        <Text style={paragraph}>
          Review and approve or decline this signup from the admin dashboard.
        </Text>

        <Section style={ctaContainer}>
          <Link href={adminDashboardUrl} style={ctaButton}>
            Review Waitlist
          </Link>
        </Section>

        <Text style={signoff}>&mdash; Vatic Platform</Text>
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

const ctaContainer = {
  textAlign: "center" as const,
  margin: "28px 0",
}

const ctaButton = {
  backgroundColor: "#FF7849",
  color: "#FFFFFF",
  padding: "14px 36px",
  borderRadius: "8px",
  fontSize: "16px",
  fontWeight: "600" as const,
  textDecoration: "none",
  display: "inline-block",
}

const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
