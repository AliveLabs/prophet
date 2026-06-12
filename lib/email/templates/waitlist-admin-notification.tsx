import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

type Brand = "ticket" | "neat"

interface WaitlistAdminNotificationProps {
  signupEmail: string
  signupName?: string
  adminDashboardUrl: string
  brand?: Brand
}

const BRAND_LABEL: Record<Brand, { product: string; signoff: string }> = {
  ticket: { product: "Ticket", signoff: "— Ticket Platform" },
  neat: { product: "Neat", signoff: "— Neat Platform" },
}

export function WaitlistAdminNotification({
  signupEmail,
  signupName,
  adminDashboardUrl,
  brand = "ticket",
}: WaitlistAdminNotificationProps) {
  const label = BRAND_LABEL[brand]
  return (
    <EmailLayout
      preview={`New ${label.product} waitlist signup: ${signupEmail}`}
    >
      <Section>
        <Text style={emailStyles.heading}>New {label.product} Waitlist Signup</Text>
        <Text style={emailStyles.paragraph}>
          {signupName ? (
            <>
              <strong style={emailStyles.strongText}>{signupName}</strong> (
              {signupEmail}) just joined the {label.product} waitlist.
            </>
          ) : (
            <>
              <strong style={emailStyles.strongText}>{signupEmail}</strong> just
              joined the {label.product} waitlist.
            </>
          )}
        </Text>
        <Text style={emailStyles.paragraph}>
          Review and approve or decline this signup from the admin dashboard.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={adminDashboardUrl} style={emailStyles.ctaButton}>
            Review Waitlist
          </Link>
        </Section>

        <Text style={emailStyles.signoff}>{label.signoff}</Text>
      </Section>
    </EmailLayout>
  )
}
