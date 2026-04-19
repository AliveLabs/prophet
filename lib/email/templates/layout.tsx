import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Link,
} from "@react-email/components"
import type { ReactNode } from "react"

interface EmailLayoutProps {
  children: ReactNode
  preview?: string
}

export function EmailLayout({ children, preview }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      {preview && <Text style={{ display: "none" }}>{preview}</Text>}
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Ticket</Text>
          </Section>

          <Hr style={divider} />

          <Section style={content}>{children}</Section>

          <Hr style={divider} />

          <Section style={footer}>
            <Text style={footerText}>
              Ticket is powered by Vatic — competitive intelligence by{" "}
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
