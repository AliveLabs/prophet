import { NextResponse } from "next/server"
import { verifyUnsubscribeParams } from "@/lib/marketing/unsubscribe-token"
import { setMarketingEmailOptOut } from "@/lib/marketing/suppression"

// D7 unsubscribe: RFC 8058 one-click endpoint. Chris's templates carry:
//
//   List-Unsubscribe: <https://app.getticket.ai/api/unsubscribe?e=...&s=...>
//   List-Unsubscribe-Post: List-Unsubscribe=One-Click
//
// Mail providers POST to the List-Unsubscribe URI (query params included)
// with body `List-Unsubscribe=One-Click` and expect a 2xx with no rendered
// page and no further interaction. We verify the same HMAC params as the
// /unsubscribe page and record the opt-out.
//
// A one-click POST ALWAYS unsubscribes: RFC 8058 has no resubscribe
// semantics, so any `a` param is ignored here. Resubscribe exists only on
// the human-facing page.
//
// We deliberately do not require the `List-Unsubscribe=One-Click` body:
// the HMAC already authorizes the action, and providers vary in how they
// send the form body. Be liberal in what we accept.
//
// Status codes leak nothing about contact existence: 400 means the
// SIGNATURE failed (pure crypto, no DB touch), and a valid signature for an
// address with no contact row is a 200 no-op.

export async function POST(req: Request) {
  const url = new URL(req.url)
  const email = verifyUnsubscribeParams(
    url.searchParams.get("e"),
    url.searchParams.get("s")
  )
  if (!email) return new NextResponse(null, { status: 400 })

  const result = await setMarketingEmailOptOut(email, true)
  if (!result.ok) return new NextResponse(null, { status: 500 })

  return new NextResponse(null, { status: 200 })
}

// Some clients open the List-Unsubscribe URI in a browser instead of using
// one-click. Hand them the human-facing page with the same params.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const target = new URL("/unsubscribe", url.origin)
  target.search = url.search
  return NextResponse.redirect(target, 303)
}
