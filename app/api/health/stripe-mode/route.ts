// ---------------------------------------------------------------------------
// GET /api/health/stripe-mode — read-only diagnostic: which Stripe environment is
// PROD actually using? The Stripe secret keys are Vercel "Sensitive" (unreadable
// via the dashboard OR `vercel env pull`), so neither we nor a pulled env file can
// tell test-vs-live. This reports the RUNTIME truth from the deployed app itself:
//   • keyMode      — derived from the key PREFIX (sk_test_ / sk_live_); never the secret
//   • stripeLivemode — Stripe's own `livemode` flag on a real object (authoritative)
//   • customer/subscription counts + the known Cane's customer lookup
//
// Token-gated by a sha256 (only the HASH is committed; the raw token is held off-repo).
// TEMP diagnostic — remove at end of the current work (tracked in memory).
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server"
import crypto from "node:crypto"
import type Stripe from "stripe"
import { getStripeClient } from "@/lib/stripe/client"

export const maxDuration = 30

const EXPECTED_TOKEN_SHA256 = "0210c2f16a2e46f1ce36940814d15e8d364ad12b7226145ae0da0daa28f7ddb2"
const CANES_CUSTOMER_ID = "cus_UgeYus56hmxKTN"

export async function GET(req: Request) {
  const provided = new URL(req.url).searchParams.get("token") ?? ""
  const ok =
    provided.length > 0 &&
    crypto.createHash("sha256").update(provided).digest("hex") === EXPECTED_TOKEN_SHA256
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rawKey = process.env.STRIPE_SECRET_KEY ?? ""
  const keyMode = rawKey.startsWith("sk_live_")
    ? "live"
    : rawKey.startsWith("sk_test_")
      ? "test"
      : rawKey
        ? "unknown-prefix"
        : "MISSING"

  try {
    const stripe = getStripeClient()
    const [custs, subs] = await Promise.all([
      stripe.customers.list({ limit: 100 }),
      stripe.subscriptions.list({ status: "all", limit: 100 }),
    ])

    let canesCustomer: Record<string, unknown>
    try {
      const c = await stripe.customers.retrieve(CANES_CUSTOMER_ID)
      if ("deleted" in c && c.deleted) {
        canesCustomer = { found: false, deleted: true }
      } else {
        // No PII — just existence + which environment it lives in.
        canesCustomer = { found: true, livemode: (c as Stripe.Customer).livemode }
      }
    } catch (e) {
      canesCustomer = { found: false, error: e instanceof Error ? e.message : String(e) }
    }

    return NextResponse.json({
      keyMode,
      stripeLivemode: custs.data[0]?.livemode ?? subs.data[0]?.livemode ?? null,
      customerCount: custs.data.length,
      subscriptionCount: subs.data.length,
      canesCustomer,
      checkedAt: new Date().toISOString(),
    })
  } catch (err) {
    // getStripeClient() throws if STRIPE_SECRET_KEY is missing at runtime — itself a finding.
    return NextResponse.json(
      { keyMode, error: "stripe call failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
