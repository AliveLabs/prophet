import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Link,
  Img,
} from "@react-email/components"
import type { CSSProperties, ReactNode } from "react"

export type EmailBrand = "Ticket" | "Neat"

interface EmailLayoutProps {
  children: ReactNode
  preview?: string
  brand?: EmailBrand
}

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.getticket.ai"

export function EmailLayout({
  children,
  preview,
  brand = "Ticket",
}: EmailLayoutProps) {
  const showLogo = brand === "Ticket"
  return (
    <Html lang="en">
      <Head />
      {preview && <Text style={{ display: "none" }}>{preview}</Text>}
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            {showLogo && (
              <Img
                src={`${APP_URL}/ticket/assets/png/ticket-favicon-192.png`}
                alt="Ticket"
                width={48}
                height={48}
                style={logoImg}
              />
            )}
            <Text style={wordmark}>{brand}</Text>
          </Section>

          <Hr style={divider} />

          <Section style={content}>{children}</Section>

          <Hr style={divider} />

          <Section style={footer}>
            <Text style={footerText}>
              {brand} is powered by Vatic — competitive intelligence by{" "}
              <Link href="https://alivelabs.co" style={footerLink}>
                Alive Labs
              </Link>
              .
            </Text>
            <Text style={footerText}>
              &copy; 2026 Alive Labs. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// ---------------------------------------------------------------------------
// Newsprint design tokens (email-safe inline values)
// ---------------------------------------------------------------------------

const PAPER = "#F5F3EF"
const CARD = "#FFFFFF"
const RULE = "#DEDAD3"
const INK = "#1C1917"
const PRINT = "#4D4843"
const ASH = "#6E6862"
const RUST = "#B85C38"
const SUCCESS = "#3A8066"
const ALERT = "#C44040"

const FONT_SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif"
const FONT_SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const FONT_CONDENSED = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif"
const FONT_MONO = "'Space Mono', ui-monospace, Menlo, monospace"

// ---------------------------------------------------------------------------
// Layout shell styles
// ---------------------------------------------------------------------------

const body = {
  backgroundColor: PAPER,
  fontFamily: FONT_SANS,
  margin: "0",
  padding: "0",
}

const container = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "40px 24px",
}

const header = {
  textAlign: "center" as const,
  padding: "0 0 16px",
}

const logoImg = {
  display: "block",
  margin: "0 auto 8px",
  borderRadius: "8px",
}

const wordmark = {
  fontFamily: FONT_CONDENSED,
  fontSize: "22px",
  fontWeight: "700" as const,
  color: INK,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  margin: "0",
}

const divider = {
  borderColor: RULE,
  margin: "0",
}

const content = {
  backgroundColor: CARD,
  border: `1px solid ${RULE}`,
  borderRadius: "6px",
  padding: "32px 36px",
  margin: "24px 0",
}

const footer = {
  textAlign: "center" as const,
  padding: "16px 0 0",
}

const footerText = {
  fontSize: "12px",
  color: ASH,
  margin: "4px 0",
}

const footerLink = {
  color: RUST,
  textDecoration: "none",
}

// ---------------------------------------------------------------------------
// Shared Newsprint styles for all email templates
// ---------------------------------------------------------------------------

export const emailStyles = {
  /** Small uppercase label above a headline. */
  kicker: {
    fontFamily: FONT_CONDENSED,
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: RUST,
    margin: "0 0 8px",
  },
  /** Display serif headline. */
  heading: {
    fontFamily: FONT_SERIF,
    fontSize: "30px",
    fontWeight: 400,
    lineHeight: "1.1",
    letterSpacing: "-0.01em",
    color: INK,
    margin: "0 0 16px",
  },
  /** Secondary serif heading. */
  heading2: {
    fontFamily: FONT_SERIF,
    fontSize: "22px",
    fontWeight: 400,
    lineHeight: "1.2",
    letterSpacing: "-0.01em",
    color: INK,
    margin: "24px 0 8px",
  },
  /** Standard body paragraph. */
  paragraph: {
    fontFamily: FONT_SANS,
    fontSize: "15px",
    lineHeight: "1.6",
    color: PRINT,
    margin: "0 0 12px",
  },
  /** Body paragraph that preserves user-entered line breaks. */
  paragraphPreWrap: {
    fontFamily: FONT_SANS,
    fontSize: "15px",
    lineHeight: "1.6",
    color: PRINT,
    margin: "0 0 12px",
    whiteSpace: "pre-wrap",
  },
  /** Bulleted/list line. */
  listItem: {
    fontFamily: FONT_SANS,
    fontSize: "14px",
    lineHeight: "1.6",
    color: PRINT,
    margin: "4px 0",
    paddingLeft: "12px",
  },
  /** Monospace details — codes, datelines. */
  mono: {
    fontFamily: FONT_MONO,
    fontSize: "13px",
    lineHeight: "1.6",
    color: PRINT,
  },
  /** Centered wrapper around a CTA button. */
  ctaContainer: {
    textAlign: "center",
    margin: "28px 0",
  },
  /** Primary CTA button. */
  ctaButton: {
    fontFamily: FONT_SANS,
    backgroundColor: RUST,
    color: "#FFFFFF",
    padding: "12px 32px",
    borderRadius: "4px",
    fontSize: "15px",
    fontWeight: 600,
    textDecoration: "none",
    display: "inline-block",
  },
  /** Destructive/urgent CTA button (e.g. payment failed). */
  alertCtaButton: {
    fontFamily: FONT_SANS,
    backgroundColor: ALERT,
    color: "#FFFFFF",
    padding: "12px 32px",
    borderRadius: "4px",
    fontSize: "15px",
    fontWeight: 600,
    textDecoration: "none",
    display: "inline-block",
  },
  /** Inline text link. */
  inlineLink: {
    color: RUST,
    textDecoration: "underline",
  },
  /** Italic team signoff. */
  signoff: {
    fontFamily: FONT_SANS,
    fontSize: "15px",
    color: PRINT,
    margin: "24px 0 0",
    fontStyle: "italic",
  },
  /** Destructive/warning emphasis. */
  alertText: {
    color: ALERT,
  },
  /** Success/confirmation emphasis. */
  successText: {
    color: SUCCESS,
  },
  /** Inline bold emphasis in ink. */
  strongText: {
    color: INK,
  },
  /** Serif pull quote with a rust rule. */
  pullQuote: {
    fontFamily: FONT_SERIF,
    fontSize: "20px",
    lineHeight: "1.4",
    color: INK,
    margin: "20px 0",
    paddingLeft: "14px",
    borderLeft: `3px solid ${RUST}`,
  },
  /** Small muted/secondary text. */
  mutedText: {
    fontFamily: FONT_SANS,
    fontSize: "13px",
    color: ASH,
    margin: "0 0 12px",
  },
  /** Small muted italic footnote (tips, asides). */
  footnote: {
    fontFamily: FONT_SANS,
    fontSize: "13px",
    color: ASH,
    fontStyle: "italic",
    margin: "0 0 12px",
  },
  /** Monospace fallback URL line under a CTA. */
  fallbackText: {
    fontFamily: FONT_MONO,
    fontSize: "12px",
    lineHeight: "1.5",
    color: ASH,
    margin: "0 0 16px",
    wordBreak: "break-all",
  },
  /** Boxed-out detail panel on paper background. */
  infoBox: {
    backgroundColor: PAPER,
    border: `1px solid ${RULE}`,
    borderRadius: "4px",
    padding: "16px 20px",
    margin: "16px 0",
  },
  /** Line item inside an infoBox. */
  infoItem: {
    fontFamily: FONT_SANS,
    fontSize: "14px",
    lineHeight: "1.6",
    color: PRINT,
    margin: "4px 0",
  },
  /** Tiny inline uppercase tag (e.g. play kind in the digest). */
  tagLabel: {
    fontFamily: FONT_CONDENSED,
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: RUST,
    marginRight: "8px",
  },
} satisfies Record<string, CSSProperties>
