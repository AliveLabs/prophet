import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { WaitlistConfirmation } from "@/lib/email/templates/waitlist-confirmation"
import { WaitlistAdminNotification } from "@/lib/email/templates/waitlist-admin-notification"
import {
  upsertMarketingContact,
  type MarketingIndustryType,
  type MarketingSource,
} from "@/lib/marketing/contacts"

const ADMIN_NOTIFY_EMAIL = "chris@alivelabs.io"

// CORS allow-list. The marketing site at getticket.ai (a separate Vercel
// project, `ticket-marketing`) posts cross-origin to this endpoint. Anything
// not in this list is treated as same-origin (in-app landing page) or denied.
//
// useneat.ai placeholder is left commented until Neat actually launches via the
// vatic-core clone — the production rebrand for liquor lives on a separate
// Vercel project so it would not POST here anyway, but keeping the marker
// makes the intent visible in code review.
const ALLOWED_ORIGINS = new Set<string>([
  "https://getticket.ai",
  "https://www.getticket.ai",
  // Local dev for the marketing site running on a different port.
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
])

function corsHeadersFor(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    }
  }
  return {}
}

function jsonWithCors(
  origin: string | null,
  body: unknown,
  init?: ResponseInit,
) {
  const headers = {
    ...(init?.headers as Record<string, string> | undefined),
    ...corsHeadersFor(origin),
  }
  return NextResponse.json(body, { ...init, headers })
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    // Reject preflights from non-allow-listed origins. No CORS headers leaked.
    return new Response(null, { status: 403 })
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  })
}

interface WaitlistRequestBody {
  email?: string
  first_name?: string
  last_name?: string
  business_name?: string
  source?: string
  industry_type?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  // Allows callers to set notes themselves (admin tooling, future use).
  notes?: string
}

interface UtmStash {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
}

function pickUtm(body: WaitlistRequestBody): UtmStash | null {
  const utm: UtmStash = {}
  if (body.utm_source) utm.source = body.utm_source
  if (body.utm_medium) utm.medium = body.utm_medium
  if (body.utm_campaign) utm.campaign = body.utm_campaign
  if (body.utm_term) utm.term = body.utm_term
  if (body.utm_content) utm.content = body.utm_content
  return Object.keys(utm).length > 0 ? utm : null
}

function deriveSourceFromOrigin(origin: string | null): MarketingSource {
  // `https://getticket.ai` and `www.getticket.ai` both attribute as
  // `getticket.ai`. Same-origin POSTs from the in-app landing page (e.g. a dev
  // running on localhost) get `manual` so they are never confused with real
  // marketing-site signups in the funnel reports.
  if (
    origin === "https://getticket.ai" ||
    origin === "https://www.getticket.ai"
  ) {
    return "getticket.ai"
  }
  return "manual"
}

function isAllowedSource(value: string): value is MarketingSource {
  return (
    value === "getticket.ai" ||
    value === "goneat.ai" ||
    value === "auricmobile.app" ||
    value === "outbound" ||
    value === "referral" ||
    value === "import" ||
    value === "manual"
  )
}

function isAllowedIndustryType(value: string): value is MarketingIndustryType {
  return value === "restaurant" || value === "liquor_store"
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin")

  try {
    const body = (await request.json()) as WaitlistRequestBody
    const { email, first_name, last_name, business_name } = body

    if (!email || typeof email !== "string") {
      return jsonWithCors(
        origin,
        { ok: false, error: "Email is required." },
        { status: 400 },
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return jsonWithCors(
        origin,
        { ok: false, error: "Please enter a valid email address." },
        { status: 400 },
      )
    }

    const supabase = createAdminSupabaseClient()
    const normalizedEmail = email.toLowerCase().trim()
    const trimmedFirst = (first_name || "").trim()
    const trimmedLast = (last_name || "").trim()
    const trimmedBusiness = (business_name || "").trim()
    const fullName =
      [trimmedFirst, trimmedLast].filter(Boolean).join(" ") || null

    // Resolve attribution. Origin is authoritative for the brand mapping (a
    // restaurant marketing site cannot pretend to be a liquor signup), and the
    // body provides UTM details for downstream attribution.
    const isCrossOriginGetticket =
      origin === "https://getticket.ai" || origin === "https://www.getticket.ai"

    let resolvedIndustry: MarketingIndustryType
    if (isCrossOriginGetticket) {
      // getticket.ai is restaurant-only; ignore any body-supplied value.
      resolvedIndustry = "restaurant"
    } else if (
      typeof body.industry_type === "string" &&
      isAllowedIndustryType(body.industry_type)
    ) {
      resolvedIndustry = body.industry_type
    } else {
      // Same-origin landing pages and admin tooling default to restaurant
      // because Ticket is the only customer-facing vertical in production.
      resolvedIndustry = "restaurant"
    }

    let resolvedSource: MarketingSource
    if (typeof body.source === "string" && isAllowedSource(body.source)) {
      // Cross-origin from getticket.ai must not claim a non-getticket source.
      if (
        isCrossOriginGetticket &&
        body.source !== "getticket.ai" &&
        body.source !== "manual"
      ) {
        resolvedSource = "getticket.ai"
      } else {
        resolvedSource = body.source
      }
    } else {
      resolvedSource = deriveSourceFromOrigin(origin)
    }

    // Encode UTMs as JSON in waitlist_signups.notes (existing column). No
    // schema migration needed; admin sees attribution via /admin/waitlist.
    // If `notes` was supplied by the caller (e.g. admin tooling) it wins.
    const utm = pickUtm(body)
    let notesValue: string | null = null
    if (typeof body.notes === "string" && body.notes.trim()) {
      notesValue = body.notes.trim()
    } else if (utm) {
      notesValue = JSON.stringify({ utm })
    }

    const { data: existing } = await supabase
      .from("waitlist_signups")
      .select("id, status")
      .eq("email", normalizedEmail)
      .maybeSingle()

    if (existing) {
      if (existing.status === "pending") {
        return jsonWithCors(
          origin,
          { ok: false, error: "This email is already on our waitlist." },
          { status: 409 },
        )
      }

      if (existing.status === "approved") {
        const { data: authUsers } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        })
        const authUserExists = authUsers?.users?.some(
          (u) => u.email === normalizedEmail,
        )

        if (authUserExists) {
          return jsonWithCors(
            origin,
            { ok: false, error: "This email is already on our waitlist." },
            { status: 409 },
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
            business_name: trimmedBusiness || null,
            source: resolvedSource,
            notes: notesValue,
            admin_notes: null,
            reviewed_by: null,
            reviewed_at: null,
          })
          .eq("id", existing.id)

        if (updateError) {
          console.error("Waitlist reapply error:", updateError)
          return jsonWithCors(
            origin,
            {
              ok: false,
              error: "Could not process your signup. Please try again.",
            },
            { status: 500 },
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
          business_name: trimmedBusiness || null,
          source: resolvedSource,
          notes: notesValue,
          status: "pending",
        })

      if (insertError) {
        console.error("Waitlist insert error:", insertError)
        return jsonWithCors(
          origin,
          { ok: false, error: "Could not save your signup. Please try again." },
          { status: 500 },
        )
      }
    }

    // Phase 3 marketing automation mirror. Fire-and-forget: a failure to reach
    // marketing.contacts must never surface as a failed waitlist signup.
    // Chris's n8n workflows read this row to drive the nurture drip.
    upsertMarketingContact({
      email: normalizedEmail,
      status: "waitlist",
      industryType: resolvedIndustry,
      source: resolvedSource,
      firstName: trimmedFirst || null,
      lastName: trimmedLast || null,
    }).catch((err) =>
      console.error("marketing.contacts mirror failed:", err),
    )

    const confirmResult = await sendEmail({
      to: normalizedEmail,
      subject: "You're on the Ticket waitlist",
      react: WaitlistConfirmation({
        name: fullName ?? undefined,
      }),
      clientFacing: true,
      overrideClientEmailPause: false,
    })

    if (!confirmResult.ok) {
      console.error("Waitlist confirmation email failed:", confirmResult.error)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.getticket.ai"

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

    return jsonWithCors(origin, { ok: true })
  } catch {
    return jsonWithCors(origin, { ok: false, error: "Invalid request." }, { status: 400 })
  }
}
