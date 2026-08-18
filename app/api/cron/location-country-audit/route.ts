import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { auditLocationCountries, summarizeCountryAudit } from "@/lib/geo/country-audit"
import { sendEmail } from "@/lib/email/send"
import { InternalAlert } from "@/lib/email/templates/internal-alert"

export const maxDuration = 300

// Does every location we serve actually sit in a country we serve? (ALT-606)
//
// The guard at the entry points refuses a non-US location at the moment it is added. This is the
// second half: it re-checks what is ALREADY in the database, on a schedule.
//
// WHY IT CANNOT JUST READ `locations.country`. That column is written from data the client
// supplied, so on the one path where the guard degrades (a Places outage, where we fall back to
// the submitted value) the stored country is exactly the thing that would be wrong. A row that
// slipped through says "US" precisely because someone said so. The only trustworthy check is to
// re-resolve `primary_place_id` against Places and read the country off Google's answer.
//
// It also catches two things that have nothing to do with anyone acting badly: a place id that
// has gone stale, and a listing that was re-pointed at a different business after we stored it.
// Both are real, and both mean the data we are selling is about somewhere else.
//
// OBSERVE ONLY. It never deletes, suspends, or edits. Remediation is a human decision, partly
// because the first move is not a database one: a non-US org means lifecycle email has been
// going somewhere our CAN-SPAM posture does not cover, so the sends stop before anything else.
// An automated cleanup would race that judgement.
const BATCH = 200

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  // Same polarity as every other cron here: a missing secret FAILS CLOSED.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const { data: rows, error } = await admin
    .from("locations")
    .select("id, name, country, primary_place_id, organization_id")
    .not("primary_place_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(BATCH)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const findings = await auditLocationCountries(rows ?? [])
  const summary = summarizeCountryAudit(findings)

  // Only page a human when there is something a human has to decide. An `unverifiable` row on its
  // own is usually a stale listing, so it is reported but does not raise the alarm by itself.
  if (summary.unsupported.length > 0) {
    try {
      await sendEmail({
        to: (process.env.OPS_ALERT_EMAILS ?? "bryan@alivelabs.io")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        subject: `[Ticket] ${summary.unsupported.length} location(s) resolve outside the United States`,
        react: InternalAlert({
          heading: "Locations outside the United States",
          lines: [
            ...summary.unsupported.map(
              (f) =>
                `${f.name ?? f.locationId}: resolves to ${f.resolvedCountry ?? "unknown"}, stored as ${f.storedCountry ?? "null"} (org ${f.organizationId ?? "unknown"})`,
            ),
            "Stop lifecycle email for these organizations before anything else: our email posture is built against US rules only. Then decide on the accounts.",
          ],
        }),
      })
    } catch (err) {
      // An alert that fails must not fail the audit; the response body still carries the finding.
      console.error("[country-audit] alert failed:", err)
    }
  }

  return NextResponse.json({
    ok: true,
    checked: findings.length,
    unsupported: summary.unsupported,
    unverifiable: summary.unverifiable,
  })
}
