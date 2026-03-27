import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { WaitlistConfirmation } from "@/lib/email/templates/waitlist-confirmation"

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
    const fullName = [trimmedFirst, trimmedLast].filter(Boolean).join(" ") || null

    const { error } = await supabase.from("waitlist_signups").upsert(
      {
        email: normalizedEmail,
        first_name: trimmedFirst || null,
        last_name: trimmedLast || null,
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const redirectTo = `${appUrl}/auth/callback`
    let actionLink: string | null = null

    const userMetadata = fullName ? { full_name: fullName } : undefined

    const { data: inviteData, error: inviteError } =
      await supabase.auth.admin.generateLink({
        type: "invite",
        email: normalizedEmail,
        options: { redirectTo, data: userMetadata },
      })

    if (inviteData?.properties?.action_link) {
      actionLink = inviteData.properties.action_link
    } else if (inviteError) {
      const { data: magicData } =
        await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: normalizedEmail,
          options: { redirectTo },
        })
      actionLink = magicData?.properties?.action_link ?? null
    }

    if (actionLink) {
      await supabase
        .from("waitlist_signups")
        .update({ status: "invited" })
        .eq("email", normalizedEmail)
    }

    sendEmail({
      to: normalizedEmail,
      subject: "Set up your Vatic account",
      react: WaitlistConfirmation({
        email: normalizedEmail,
        setupUrl: actionLink ?? `${appUrl}/signup`,
      }),
    }).catch((err) => console.error("Waitlist email failed:", err))

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 }
    )
  }
}
