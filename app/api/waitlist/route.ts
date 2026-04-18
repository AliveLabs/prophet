import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { WaitlistConfirmation } from "@/lib/email/templates/waitlist-confirmation"
import { WaitlistAdminNotification } from "@/lib/email/templates/waitlist-admin-notification"

const ADMIN_NOTIFY_EMAIL = "chris@alivelabs.io"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, first_name, last_name } = body

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { ok: false, error: "Email is required." },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid email address." },
        { status: 400 }
      )
    }

    const supabase = createAdminSupabaseClient()
    const normalizedEmail = email.toLowerCase().trim()
    const trimmedFirst = (first_name || "").trim()
    const trimmedLast = (last_name || "").trim()
    const fullName =
      [trimmedFirst, trimmedLast].filter(Boolean).join(" ") || null

    const { data: existing } = await supabase
      .from("waitlist_signups")
      .select("id, status")
      .eq("email", normalizedEmail)
      .maybeSingle()

    if (existing) {
      if (existing.status === "pending") {
        return NextResponse.json(
          { ok: false, error: "This email is already on our waitlist." },
          { status: 409 }
        )
      }

      if (existing.status === "approved") {
        const { data: authUsers } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        })
        const authUserExists = authUsers?.users?.some(
          (u) => u.email === normalizedEmail
        )

        if (authUserExists) {
          return NextResponse.json(
            { ok: false, error: "This email is already on our waitlist." },
            { status: 409 }
          )
        }
      }

      if (existing.status === "declined" || existing.status === "approved") {
        const { error: updateError } = await supabase
          .from("waitlist_signups")
          .update({
            status: "pending",
            first_name: trimmedFirst || null,
            last_name: trimmedLast || null,
            admin_notes: null,
            reviewed_by: null,
            reviewed_at: null,
          })
          .eq("id", existing.id)

        if (updateError) {
          console.error("Waitlist reapply error:", updateError)
          return NextResponse.json(
            { ok: false, error: "Could not process your signup. Please try again." },
            { status: 500 }
          )
        }
      }
    } else {
      const { error: insertError } = await supabase
        .from("waitlist_signups")
        .insert({
          email: normalizedEmail,
          first_name: trimmedFirst || null,
          last_name: trimmedLast || null,
          source: "landing_page",
          status: "pending",
        })

      if (insertError) {
        console.error("Waitlist insert error:", insertError)
        return NextResponse.json(
          { ok: false, error: "Could not save your signup. Please try again." },
          { status: 500 }
        )
      }
    }

    const confirmResult = await sendEmail({
      to: normalizedEmail,
      subject: "You're on the Vatic waitlist",
      react: WaitlistConfirmation({
        name: fullName ?? undefined,
      }),
      clientFacing: true,
      overrideClientEmailPause: false,
    })

    if (!confirmResult.ok) {
      console.error("Waitlist confirmation email failed:", confirmResult.error)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

    const adminSubject = fullName
      ? `New Ticket waitlist signup: ${fullName} (${normalizedEmail})`
      : `New Ticket waitlist signup: ${normalizedEmail}`

    sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: adminSubject,
      react: WaitlistAdminNotification({
        signupEmail: normalizedEmail,
        signupName: fullName ?? undefined,
        adminDashboardUrl: `${appUrl}/admin/waitlist`,
      }),
      clientFacing: false,
    }).catch((err) => console.error("Admin notification email failed:", err))

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 }
    )
  }
}
