import { Section, Text } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

type Brand = "ticket" | "neat"

interface WaitlistConfirmationProps {
  name?: string
  brand?: Brand
}

interface BrandCopy {
  productName: string
  // What the customer will see in the inbox preview / "monitoring..." line.
  // Different verticals talk about different things in their nurture content.
  monitoringSubject: string
  signoff: string
}

const COPY: Record<Brand, BrandCopy> = {
  ticket: {
    productName: "Ticket",
    monitoringSubject: "your competitive landscape",
    signoff: "— The Ticket Team",
  },
  neat: {
    productName: "Neat",
    monitoringSubject: "your local liquor market",
    signoff: "— The Neat Team",
  },
}

export function WaitlistConfirmation({
  name,
  brand = "ticket",
}: WaitlistConfirmationProps) {
  const copy = COPY[brand]
  return (
    <EmailLayout preview={`You're on the ${copy.productName} waitlist`}>
      <Section>
        <Text style={emailStyles.heading}>
          {name ? `Thanks, ${name}!` : "Thanks for signing up!"}
        </Text>
        <Text style={emailStyles.paragraph}>
          You&rsquo;re now on the {copy.productName} waitlist. We&rsquo;re
          rolling out access in limited batches to ensure every customer gets
          the best possible experience.
        </Text>
        <Text style={emailStyles.paragraph}>
          When your spot is ready, we&rsquo;ll send you an email with everything
          you need to get started &mdash; including a link to set up your
          dashboard and begin monitoring {copy.monitoringSubject}.
        </Text>
        <Text style={emailStyles.paragraph}>
          In the meantime, sit tight. We&rsquo;ll be in touch soon.
        </Text>
        <Text style={emailStyles.signoff}>{copy.signoff}</Text>
      </Section>
    </EmailLayout>
  )
}
