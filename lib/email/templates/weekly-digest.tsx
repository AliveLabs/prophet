// Weekly digest (complete-picture · Batch 4) — a highlights email whose only job is
// driving the operator back to their brief. Top plays + headline, one link, no noise.

import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

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
  /** Settings deep link for the "change the day this arrives" footer line
   *  (D6 ruling: the digest lands on a per-user preferred day, Monday default,
   *  and the email itself must offer the dial). Optional so existing preview
   *  callers keep compiling; omitted -> no footer line. */
  digestDayUrl?: string
}

export function WeeklyDigest({ locationName, headline, deck, plays, briefUrl, digestDayUrl }: WeeklyDigestProps) {
  return (
    <EmailLayout preview={`This week for ${locationName}: ${headline}`}>
      <Section>
        <Text style={emailStyles.kicker}>Your week at {locationName}</Text>
        <Text style={emailStyles.heading}>{headline}</Text>
        {deck ? <Text style={emailStyles.paragraph}>{deck}</Text> : null}

        {plays.length ? (
          <Section style={emailStyles.infoBox}>
            {plays.map((p, i) => (
              <Text key={i} style={emailStyles.infoItem}>
                <span style={emailStyles.tagLabel}>{p.kind}</span> {p.title}
              </Text>
            ))}
          </Section>
        ) : null}

        <Text style={emailStyles.paragraph}>
          The full plan — who, when, where, and the copy to post — is on your brief.
        </Text>
        <Text style={emailStyles.ctaContainer}>
          <Link href={briefUrl} style={emailStyles.ctaButton}>
            Open your brief →
          </Link>
        </Text>

        {digestDayUrl ? (
          <Text style={emailStyles.mutedText}>
            This digest arrives on the day you choose.{" "}
            <Link href={digestDayUrl}>Change the day this arrives</Link>
          </Text>
        ) : null}
      </Section>
    </EmailLayout>
  )
}
