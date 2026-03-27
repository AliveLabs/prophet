import type { ReactElement } from "react"
import { resend } from "./client"

interface SendEmailParams {
  to: string | string[]
  subject: string
  react: ReactElement
}

const FROM_ADDRESS = "Vatic <info@getvatic.com>"

export async function sendEmail({ to, subject, react }: SendEmailParams) {
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
