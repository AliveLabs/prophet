import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, type EmailBrand } from "./layout"

interface PaymentFailedProps {
  brand: EmailBrand
  amount: number
  currency: string
  portalUrl: string
  invoiceUrl: string | null
}

// Sent on invoice.payment_failed. Stripe Smart Retries will try the card
// again automatically; this email nudges the customer to update their card
// in the Portal so dunning doesn't lose them.
export function PaymentFailed({
  brand,
  amount,
  currency,
  portalUrl,
  invoiceUrl,
}: PaymentFailedProps) {
  const amountStr = `${currency} ${amount.toFixed(2)}`
  const subject = `Action needed: ${brand} payment failed`
  return (
    <EmailLayout preview={subject} brand={brand}>
      <Section>
        <Text style={heading}>Your {brand} payment didn&rsquo;t go through.</Text>

        <Text style={paragraph}>
          We tried to charge your card for <strong>{amountStr}</strong> and it
          was declined. We&rsquo;ll retry automatically over the next few
          days, but if you&rsquo;d like to avoid any interruption to your
          subscription, please update your payment method now.
        </Text>

        <Section style={ctaContainer}>
          <Link href={portalUrl} style={ctaButton}>
            Update payment method
          </Link>
        </Section>

        {invoiceUrl && (
          <Text style={paragraph}>
            You can also{" "}
            <Link href={invoiceUrl} style={inlineLink}>
              view the invoice directly
            </Link>
            .
          </Text>
        )}

        <Text style={signoff}>— The {brand} Team</Text>
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
  backgroundColor: "#DC2626",
  color: "#FFFFFF",
  padding: "12px 32px",
  borderRadius: "8px",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  display: "inline-block",
}
const inlineLink = {
  color: "#FF7849",
  textDecoration: "underline",
}
const signoff = {
  fontSize: "15px",
  color: "#A1A1AA",
  margin: "24px 0 0",
  fontStyle: "italic" as const,
}
