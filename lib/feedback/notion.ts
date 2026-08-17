// ---------------------------------------------------------------------------
// Beta feedback -> a Notion ticket, assigned to a human.
//
// WHY THIS EXISTS. The feedback form wrote its row and then best-effort emailed
// ops. On 2026-08-17 Chris filed seven entries during a walkthrough: all seven
// rows saved, ONE email arrived, and no ticket was created anywhere because
// this integration did not exist. Feedback that reaches a table nobody queries
// is feedback we did not receive.
//
// SHAPE. Hand-rolled REST, one `fetch`, no SDK — the same call the rest of this
// codebase makes to every other vendor, and a dependency is not worth carrying
// for a single endpoint.
//
// IDS COME FROM THE ENVIRONMENT. The token, the database, and the assignee are
// all env-driven. A Notion integration token in source is a credential in git,
// and a hardcoded assignee id silently keeps routing to someone who has left.
// Absent config is NOT an error: `isNotionConfigured()` is false, the caller
// skips, and the row stays unticketed for the sweeper to retry once the token
// exists. That is what lets this ship before the token does.
//
// NEVER THROWS INTO THE REQUEST PATH. Every function returns a result object.
// A vendor outage must not turn "your feedback was saved" into an error for the
// operator who just typed it.
// ---------------------------------------------------------------------------

const NOTION_API = "https://api.notion.com/v1/pages"
const NOTION_VERSION = "2022-06-28"

/** Notion integration token (`ntn_...`). */
const NOTION_TOKEN = process.env.NOTION_API_KEY ?? ""
/** The Tickets database id. */
const NOTION_DATABASE_ID = process.env.NOTION_TICKETS_DATABASE_ID ?? ""
/** Notion user id who owns incoming feedback. */
const NOTION_ASSIGNEE_ID = process.env.NOTION_FEEDBACK_ASSIGNEE_ID ?? ""

export function isNotionConfigured(): boolean {
  return Boolean(NOTION_TOKEN && NOTION_DATABASE_ID)
}

export type FeedbackTicketInput = {
  /** beta_feedback.id — quoted in the ticket so the row and ticket are linkable. */
  feedbackId: string
  message: string
  category: string | null
  pagePath: string | null
  userEmail: string | null
  orgName: string | null
  createdAt: string
}

export type NotionResult =
  | { ok: true; pageId: string }
  | { ok: false; skipped: true }
  | { ok: false; skipped?: false; error: string }

/**
 * The operator's own words become the title, because a title someone wrote is
 * more findable than one we generated. First line only, collapsed and clipped:
 * Notion titles are single-line, and a paragraph pasted into one is unreadable
 * in a list view. The full text is always in the body, so nothing is lost.
 */
export function ticketTitle(message: string): string {
  const firstLine = message.split(/\r?\n/).find((l) => l.trim()) ?? message
  const squashed = firstLine.replace(/\s+/g, " ").trim()
  if (squashed.length <= 90) return squashed || "Beta feedback"
  // Clip on a word boundary rather than mid-word.
  const cut = squashed.slice(0, 90)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 50 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * The form's category maps onto the Tickets database's Type.
 *
 * Unknown or absent category becomes `Bug`, deliberately. An operator who
 * bothered to report something during a beta is usually reporting a problem,
 * and a mis-typed bug gets noticed and retyped, while a mis-typed task can sit
 * in a backlog for months. Bias toward the reading that gets looked at.
 */
export function ticketType(category: string | null): "Bug" | "Feature" | "Task" {
  switch ((category ?? "").toLowerCase()) {
    case "idea":
    case "feature":
    case "request":
      return "Feature"
    case "praise":
    case "question":
      return "Task"
    default:
      return "Bug"
  }
}

/** Notion rich_text blocks cap at 2000 characters per item. */
function richText(content: string) {
  return [{ type: "text", text: { content: content.slice(0, 2000) } }]
}

function paragraph(content: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(content) },
  }
}

export async function createFeedbackTicket(input: FeedbackTicketInput): Promise<NotionResult> {
  if (!isNotionConfigured()) return { ok: false, skipped: true }

  const context = [
    input.userEmail ? `Reporter: ${input.userEmail}` : null,
    input.orgName ? `Org: ${input.orgName}` : null,
    input.pagePath ? `Page: ${input.pagePath}` : null,
    `Submitted: ${input.createdAt}`,
    `beta_feedback.id: ${input.feedbackId}`,
  ]
    .filter(Boolean)
    .join(" · ")

  const properties: Record<string, unknown> = {
    Title: { title: richText(ticketTitle(input.message)) },
    Type: { select: { name: ticketType(input.category) } },
    Priority: { select: { name: "Medium" } },
    Project: { select: { name: "Ticket" } },
    Status: { status: { name: "Not started" } },
    Notes: { rich_text: richText(`In-app beta feedback. ${context}`) },
  }
  if (NOTION_ASSIGNEE_ID) {
    properties.Assignee = { people: [{ object: "user", id: NOTION_ASSIGNEE_ID }] }
  }

  try {
    const res = await fetch(NOTION_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties,
        children: [
          {
            object: "block",
            type: "heading_2",
            heading_2: { rich_text: richText("What they said") },
          },
          // Verbatim, in a quote block. Never paraphrased: the operator's exact
          // words are the evidence, and a summary of a bug report is a worse
          // bug report.
          {
            object: "block",
            type: "quote",
            quote: { rich_text: richText(input.message) },
          },
          paragraph(context),
        ],
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, error: `Notion ${res.status}: ${body.slice(0, 300)}` }
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null
    if (!json?.id) return { ok: false, error: "Notion returned no page id" }
    return { ok: true, pageId: json.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
