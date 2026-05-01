import { Section, Text } from "@react-email/components"
import { EmailLayout } from "./layout"

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
        <Text style={heading}>
          {name ? `Thanks, ${name}!` : "Thanks for signing up!"}
        </Text>
        <Text style={paragraph}>
          You&rsquo;re now on the {copy.productName} waitlist. We&rsquo;re
          rolling out access in limited batches to ensure every customer gets
          the best possible experience.
        </Text>
        <Text style={paragraph}>
          When your spot is ready, we&rsquo;ll send you an email with everything
          you need to get started &mdash; including a link to set up your
          dashboard and begin monitoring {copy.monitoringSubject}.
        </Text>
        <Text style={paragraph}>
          In the meantime, sit tight. We&rsquo;ll be in touch soon.
        </Text>
        <Text style={signoff}>{copy.signoff}</Text>
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
