import type { ReactElement } from "react"
import { resend } from "./client"

interface SendEmailParams {
  to: string | string[]
  subject: string
  react: ReactElement
  /**
   * Mark this email as client-facing (sent to end users / prospects).
   * When true and CLIENT_EMAILS_ENABLED !== "true", the send is paused
   * unless overrideClientEmailPause is also true.
   * Default: false (treated as internal / admin-facing).
   */
  clientFacing?: boolean
  /**
   * Explicit override to send a client-facing email even when the
   * CLIENT_EMAILS_ENABLED flag is off. Use for admin-initiated flows
   * (waitlist approval/decline, admin custom emails, admin invitations)
   * and user-initiated auth actions (self-service magic link).
   * Default: false.
   */
  overrideClientEmailPause?: boolean
}

const FROM_ADDRESS = "Vatic <info@getvatic.com>"

export async function sendEmail({
  to,
  subject,
  react,
  clientFacing = false,
  overrideClientEmailPause = false,
}: SendEmailParams) {
  if (
    clientFacing === true &&
    overrideClientEmailPause !== true &&
    process.env.CLIENT_EMAILS_ENABLED !== "true"
  ) {
    console.log("[email] Client-facing email paused:", subject, "->", to)
    return {
      ok: false as const,
      paused: true as const,
      error: "Client emails paused",
    }
  }

  if (!resend) {
    console.warn("Resend not configured, skipping email:", subject)
    return { ok: false as const, error: "Resend not configured" }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: Array.isArray(to) ? to : [to],
      subject,
      react,
    })

    if (error) {
      console.error("Email send error:", error)
      return { ok: false as const, error: error.message }
    }

    return { ok: true as const, id: data?.id }
  } catch (err) {
    console.error("Email send exception:", err)
    return { ok: false as const, error: "Failed to send email" }
  }
}
