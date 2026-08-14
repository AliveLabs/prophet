// Weekly digest (complete-picture · Batch 4) — a highlights email whose only job is
// driving the operator back to their brief. Top plays + headline, one link, no noise.

import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface DigestPlay {
  title: string
  kind: string
}

/** Review-watchdog notices (phase 4.2), shaped by lib/reviews/watch-copy.ts. The
 *  email renders lines the watchdog already computed; it never re-detects. */
interface DigestWatchNotice {
  title: string
  line: string
}

interface WeeklyDigestProps {
  locationName: string
  headline: string
  deck: string
  plays: DigestPlay[]
  briefUrl: string
  /** Review changes worth an unprompted open. Leads the email when present:
   *  "your rating slipped" outranks any play. Optional so existing preview
   *  callers keep compiling; omitted or empty renders nothing. */
  watchNotices?: DigestWatchNotice[]
  /** Deep link to /reviews for the watchdog block. Omitted -> no link. */
  reviewsUrl?: string
  /** Settings deep link for the "change the day this arrives" footer line
   *  (D6 ruling: the digest lands on a per-user preferred day, Monday default,
   *  and the email itself must offer the dial). Optional so existing preview
   *  callers keep compiling; omitted -> no footer line. */
  digestDayUrl?: string
}

export function WeeklyDigest({
  locationName,
  headline,
  deck,
  plays,
  briefUrl,
  watchNotices,
  reviewsUrl,
  digestDayUrl,
}: WeeklyDigestProps) {
  const watch = watchNotices ?? []
  // A review change leads the PREVIEW line when there is one: the preview text is
  // the whole reason an operator opens without being asked, and "your rating
  // slipped" earns that open in a way a play headline does not.
  const preview = watch.length
    ? `${locationName}: ${watch[0].title}`
    : `This week for ${locationName}: ${headline}`
  return (
    <EmailLayout preview={preview}>
      <Section>
        <Text style={emailStyles.kicker}>Your week at {locationName}</Text>
        <Text style={emailStyles.heading}>{headline}</Text>
        {deck ? <Text style={emailStyles.paragraph}>{deck}</Text> : null}

        {watch.length ? (
          <Section style={emailStyles.infoBox}>
            <Text style={emailStyles.tagLabel}>What moved</Text>
            {watch.map((n, i) => (
              <Text key={i} style={emailStyles.infoItem}>
                <strong>{n.title}.</strong> {n.line}
              </Text>
            ))}
            {reviewsUrl ? (
              <Text style={emailStyles.infoItem}>
                <Link href={reviewsUrl}>See the reviews behind this</Link>
              </Text>
            ) : null}
          </Section>
        ) : null}

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
          The full plan, who and when and where plus the copy to post, is on your brief.
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
