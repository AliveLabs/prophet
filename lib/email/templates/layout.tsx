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
import type { ReactNode } from "react"

export type EmailBrand = "Ticket" | "Neat"

interface EmailLayoutProps {
  children: ReactNode
  preview?: string
  brand?: EmailBrand
}

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://www.thevatic.com"

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

const body = {
  backgroundColor: "#0F0F13",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
  fontSize: "22px",
  fontWeight: "700" as const,
  color: "#F5F3EF",
  letterSpacing: "0.02em",
  textTransform: "uppercase" as const,
  margin: "0",
}

const divider = {
  borderColor: "#322A24",
  margin: "0",
}

const content = {
  padding: "32px 0",
}

const footer = {
  textAlign: "center" as const,
  padding: "16px 0 0",
}

const footerText = {
  fontSize: "12px",
  color: "#71717A",
  margin: "4px 0",
}

const footerLink = {
  color: "#34775E",
  textDecoration: "none",
}
