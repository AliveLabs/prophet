// Weekly digest (complete-picture · Batch 4) — a highlights email whose only job is
// driving the operator back to their brief. Top plays + headline, one link, no noise.

import { Section, Text, Link } from "@react-email/components"
import { EmailLayout } from "./layout"

interface DigestPlay {
  title: string
  kind: string
}

interface WeeklyDigestProps {
  locationName: string
  headline: string
  deck: string
  plays: DigestPlay[]
  briefUrl: string
}

export function WeeklyDigest({ locationName, headline, deck, plays, briefUrl }: WeeklyDigestProps) {
  return (
    <EmailLayout preview={`This week for ${locationName}: ${headline}`}>
      <Section>
        <Text style={kicker}>Your week at {locationName}</Text>
        <Text style={heading}>{headline}</Text>
        {deck ? <Text style={paragraph}>{deck}</Text> : null}

        {plays.length ? (
          <Section style={playBox}>
            {plays.map((p, i) => (
              <Text key={i} style={playItem}>
                <span style={playKind}>{p.kind}</span> {p.title}
              </Text>
            ))}
          </Section>
        ) : null}

        <Text style={paragraph}>
          The full plan — who, when, where, and the copy to post — is on your brief.
        </Text>
        <Text style={ctaWrap}>
          <Link href={briefUrl} style={cta}>
            Open your brief →
          </Link>
        </Text>
      </Section>
    </EmailLayout>
  )
}

const kicker = {
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "#A1A1AA",
  margin: "0 0 8px",
}
const heading = {
  fontSize: "22px",
  lineHeight: "1.3",
  fontWeight: 700,
  color: "#E4E4E7",
  margin: "0 0 12px",
}
const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#A1A1AA",
  margin: "0 0 16px",
}
const playBox = {
  backgroundColor: "#18181B",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "0 0 16px",
}
const playItem = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#E4E4E7",
  margin: "0 0 8px",
}
const playKind = {
  fontSize: "11px",
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  color: "#D97706",
  marginRight: "8px",
}
const ctaWrap = { margin: "8px 0 0" }
const cta = {
  display: "inline-block",
  backgroundColor: "#D97706",
  color: "#18181B",
  fontSize: "14px",
  fontWeight: 600,
  padding: "10px 18px",
  borderRadius: "6px",
  textDecoration: "none",
}
