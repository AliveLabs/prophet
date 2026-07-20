import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  sendEmail,
  FROM_ADDRESS_TICKET,
  FROM_ADDRESS_NEAT,
} from "@/lib/email/send"
import { WaitlistConfirmation } from "@/lib/email/templates/waitlist-confirmation"
import { WaitlistAdminNotification } from "@/lib/email/templates/waitlist-admin-notification"
import {
  upsertMarketingContact,
  type MarketingIndustryType,
  type MarketingSource,
} from "@/lib/marketing/contacts"
import { rateLimit, clientIp } from "@/lib/http/rate-limit"

const ADMIN_NOTIFY_EMAIL = "chris@alivelabs.io"

// CORS allow-list. The marketing sites for each vertical post cross-origin
// here:
//   - getticket.ai  → Ticket  (separate Vercel project `ticket-marketing`)
//   - useneat.ai    → Neat    (separate Vercel project, owned by Bryan)
// Anything not in this list is treated as same-origin (in-app landing page)
// or denied at preflight.
const ALLOWED_ORIGINS = new Set<string>([
  "https://getticket.ai",
  "https://www.getticket.ai",
  "https://useneat.ai",
  "https://www.useneat.ai",
  // Local dev for the marketing sites running on different ports.
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
])

// Internal product brand. Drives email From-address, copy, admin-notification
// subject, and the (source, industry_type) tuple written to marketing.contacts.
type Brand = "ticket" | "neat"

interface BrandConfig {
  source: MarketingSource
  industryType: MarketingIndustryType
  fromAddress: string
  productName: string
  // Marketing-site host the brand owns (used in admin emails). The Vercel
  // domain alias is on app.<host>; the marketing site is on www.<host>.
  marketingHost: string
}

const BRAND_CONFIG: Record<Brand, BrandConfig> = {
  ticket: {
    source: "getticket.ai",
    industryType: "restaurant",
    fromAddress: FROM_ADDRESS_TICKET,
    productName: "Ticket",
    marketingHost: "getticket.ai",
  },
  neat: {
    // marketing.contacts.contacts_source_chk currently allows 'goneat.ai' but
    // not 'useneat.ai'. We attribute Neat signups under 'goneat.ai' until the
    // CHECK constraint adds the new value (separate migration owned by Chris).
    source: "goneat.ai",
    industryType: "liquor_store",
    // FROM_ADDRESS_NEAT is `Neat <info@goneat.ai>` because goneat.ai is the
    // verified Resend domain. When useneat.ai is verified in Resend, set
    // RESEND_FROM_NEAT=Neat <hello@useneat.ai> as a one-line Vercel env flip.
    fromAddress: FROM_ADDRESS_NEAT,
    productName: "Neat",
    marketingHost: "useneat.ai",
  },
}

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
  // Cloudflare Turnstile token: sent by the marketing forms when the widget
  // is configured. Required for cross-origin marketing POSTs once
  // TURNSTILE_SECRET_KEY is set (see anti-spam block in POST).
  turnstile_token?: string
  // Honeypot: a hidden field real users leave empty. Any non-empty value means
  // a bot filled it — we silently return success so the bot doesn't retry.
  hp?: string
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

// Map a request Origin to its brand. Cross-origin POSTs from a marketing
// site are authoritatively branded by their host (a Neat marketing form
// cannot pretend to be a Ticket signup). Same-origin requests (in-app
// landing page, admin tooling, localhost dev) return null and the caller
// falls back to body-supplied or default values.
function brandFromOrigin(origin: string | null): Brand | null {
  if (origin === "https://getticket.ai" || origin === "https://www.getticket.ai") {
    return "ticket"
  }
  if (origin === "https://useneat.ai" || origin === "https://www.useneat.ai") {
    return "neat"
  }
  return null
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

    // Honeypot: a hidden field the marketing forms render but keep empty. A
    // non-empty value means a bot filled every field — return a fake success
    // so it doesn't retry, and never write the junk row.
    if (typeof body.hp === "string" && body.hp.trim().length > 0) {
      return jsonWithCors(origin, { ok: true })
    }

    // The cross-origin marketing waitlist path is RETIRED. useneat.ai and
    // getticket.ai now post to their own site's /api/waitlist n8n proxy, which
    // enforces Turnstile + honeypot; those app domains are becoming login-only.
    // Reject marketing-origin signups here so this endpoint stops being a
    // direct-to-n8n spam vector. Same-origin in-app / admin requests
    // (originBrand === null) still work.
    const originBrand = brandFromOrigin(origin)
    if (originBrand) {
      return jsonWithCors(
        origin,
        { ok: false, error: "This signup path has moved." },
        { status: 410 },
      )
    }

    // SEC-M2: rate-limit per IP and per email so this unauthenticated, service-role-backed endpoint
    // can't be driven for lead-table spam or enumeration. Fail-open when Upstash is unconfigured.
    const ipRl = await rateLimit(clientIp(request), { prefix: "waitlist:ip", limit: 10, windowSeconds: 60 })
    const emailRl = await rateLimit(email.toLowerCase().trim(), { prefix: "waitlist:email", limit: 5, windowSeconds: 3600 })
    if (!ipRl.ok || !emailRl.ok) {
      return jsonWithCors(
        origin,
        { ok: false, error: "Too many requests. Please try again shortly." },
        { status: 429 },
      )
    }

    const supabase = createAdminSupabaseClient()
    const normalizedEmail = email.toLowerCase().trim()
    const trimmedFirst = (first_name || "").trim()
    const trimmedLast = (last_name || "").trim()
    const trimmedBusiness = (business_name || "").trim()
    const fullName =
      [trimmedFirst, trimmedLast].filter(Boolean).join(" ") || null

    // Resolve brand + attribution. Marketing (cross-origin) POSTs are rejected
    // above, so this only runs for same-origin callers: the in-app landing
    // page, admin tooling, or localhost dev. Body values, if valid, win;
    // otherwise default to Ticket because that's the only customer-facing
    // vertical with a same-origin in-app signup form.
    let resolvedBrand: Brand
    let resolvedIndustry: MarketingIndustryType
    let resolvedSource: MarketingSource

    if (
      typeof body.industry_type === "string" &&
      isAllowedIndustryType(body.industry_type)
    ) {
      resolvedIndustry = body.industry_type
    } else {
      resolvedIndustry = "restaurant"
    }
    resolvedBrand = resolvedIndustry === "liquor_store" ? "neat" : "ticket"

    if (typeof body.source === "string" && isAllowedSource(body.source)) {
      resolvedSource = body.source
    } else {
      resolvedSource = "manual"
    }

    const brandConfig = BRAND_CONFIG[resolvedBrand]

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
        // SEC-M2: targeted lookup instead of scanning auth.users 1000-at-a-time (a perf footgun +
        // soft existence oracle). profiles.id IS the auth user id and a row is created on signup,
        // so a matching profile means this person already completed signup (already a user, not a
        // fresh lead).
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("id")
          .eq("email", normalizedEmail)
          .limit(1)

        if (profileRows && profileRows.length > 0) {
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
      subject: `You're on the ${brandConfig.productName} waitlist`,
      from: brandConfig.fromAddress,
      react: WaitlistConfirmation({
        name: fullName ?? undefined,
        brand: resolvedBrand,
      }),
      clientFacing: true,
      overrideClientEmailPause: false,
    })

    if (!confirmResult.ok) {
      console.error("Waitlist confirmation email failed:", confirmResult.error)
    }

    // Admin dashboard always lives on the Ticket app domain regardless of
    // brand — there's one shared admin surface; the brand badge is rendered
    // by the row, not the URL.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.getticket.ai"

    const adminSubject = fullName
      ? `New ${brandConfig.productName} waitlist signup: ${fullName} (${normalizedEmail})`
      : `New ${brandConfig.productName} waitlist signup: ${normalizedEmail}`

    sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: adminSubject,
      react: WaitlistAdminNotification({
        signupEmail: normalizedEmail,
        signupName: fullName ?? undefined,
        adminDashboardUrl: `${appUrl}/admin/waitlist`,
        brand: resolvedBrand,
      }),
      clientFacing: false,
    }).catch((err) => console.error("Admin notification email failed:", err))

    return jsonWithCors(origin, { ok: true })
  } catch {
    return jsonWithCors(origin, { ok: false, error: "Invalid request." }, { status: 400 })
  }
}
