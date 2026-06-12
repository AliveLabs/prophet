import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles, type EmailBrand } from "./layout"

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
        <Text style={emailStyles.heading}>Your {brand} payment didn&rsquo;t go through.</Text>

        <Text style={emailStyles.paragraph}>
          We tried to charge your card for{" "}
          <strong style={emailStyles.alertText}>{amountStr}</strong> and it
          was declined. We&rsquo;ll retry automatically over the next few
          days, but if you&rsquo;d like to avoid any interruption to your
          subscription, please update your payment method now.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={portalUrl} style={emailStyles.alertCtaButton}>
            Update payment method
          </Link>
        </Section>

        {invoiceUrl && (
          <Text style={emailStyles.paragraph}>
            You can also{" "}
            <Link href={invoiceUrl} style={emailStyles.inlineLink}>
              view the invoice directly
            </Link>
            .
          </Text>
        )}

        <Text style={emailStyles.signoff}>— The {brand} Team</Text>
      </Section>
    </EmailLayout>
  )
}
