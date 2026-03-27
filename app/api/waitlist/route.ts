import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { WaitlistConfirmation } from "@/lib/email/templates/waitlist-confirmation"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, business_name, city } = body

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

    const { error } = await supabase.from("waitlist_signups").upsert(
      {
        email: email.toLowerCase().trim(),
        business_name: business_name || null,
        city: city || null,
        source: "landing_page",
      },
      { onConflict: "email" }
    )

    if (error) {
      console.error("Waitlist insert error:", error)
      return NextResponse.json(
        { ok: false, error: "Could not save your signup. Please try again." },
        { status: 500 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    sendEmail({
      to: normalizedEmail,
      subject: "You're on the Vatic waitlist",
      react: WaitlistConfirmation({ email: normalizedEmail }),
    }).catch((err) => console.error("Waitlist email failed:", err))

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 }
    )
  }
}
