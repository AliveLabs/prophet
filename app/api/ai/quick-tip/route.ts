// ---------------------------------------------------------------------------
// Lightweight AI endpoint – generates a single actionable tip
// Called by the RefreshOverlay while the user waits for a long-running action.
// Runs Haiku via the shared direct-REST provider (beta rescue 2.2 — was Gemini
// Flash through a hand-rolled fetch).
// SEC-H2: requires an authenticated session (it spends ANTHROPIC_API_KEY) and
// length-caps the caller-supplied context (cost + prompt-injection surface).
// ---------------------------------------------------------------------------

import { getUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { resolveOrgActorWith } from "@/lib/auth/actor"
import { clampQuickTipContext } from "@/lib/ai/quick-tip"
import { rateLimit, retryAfterSeconds } from "@/lib/http/rate-limit"
import { claudeRaw, FAST_MODEL } from "@/lib/ai/provider"
import { recordSpendEvent } from "@/lib/ai/spend-events"

export async function POST(req: Request) {
  try {
    const user = await getUser()
    if (!user) {
      return Response.json({ tip: null }, { status: 401 })
    }
    // ALT-578: session → org actor via the shared resolver (lib/auth/actor.ts). This route has
    // no org context in its body (it takes free-text `context` from the caller) but it does
    // spend ANTHROPIC_API_KEY on behalf of the signed-in user's org, and route handlers never
    // pass through the (dashboard) layout's deleted_at gate — so a soft-deleted org's member
    // could otherwise keep calling this after the org was switched off.
    const supabase = await createServerSupabaseClient()
    const actor = await resolveOrgActorWith(supabase, user.id)
    if (!actor) {
      return Response.json({ tip: null }, { status: 403 })
    }
    // Per-user rate limit: this spends ANTHROPIC_API_KEY, so cap burst abuse even for a signed-in
    // caller. Fail-open when Upstash is unconfigured (see lib/http/rate-limit).
    const rl = await rateLimit(user.id, { prefix: "quick-tip", limit: 20, windowSeconds: 60 })
    if (!rl.ok) {
      return Response.json({ tip: null }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } })
    }
    const body = await req.json().catch(() => ({}))
    const context = clampQuickTipContext(body.context)

    if (!process.env.ANTHROPIC_API_KEY || !context) {
      return Response.json({ tip: null })
    }

    const prompt = [
      "You are a local business intelligence assistant.",
      "Given the following context about a local business, generate ONE brief, specific, actionable insight or tip (max 2 sentences).",
      "Be concrete and data-driven. Do not be generic.",
      "Return only the tip text, no JSON, no markdown.",
      "",
      `Context: ${context}`,
    ].join("\n")

    // retries: 0 — this backs a loading overlay, so a failed call should return {tip:null} now
    // rather than backing off and retrying (the pre-swap fetch had no retry either). Spend
    // telemetry (beta rescue 2.3) rides onUsage, fire-and-forget so it can't add latency.
    const text = await claudeRaw(
      {
        tier: "reasoning",
        model: FAST_MODEL,
        prompt,
        maxOutputTokens: 300,
        temperature: 0.7,
        label: "quick-tip",
        onUsage: (usage) =>
          void recordSpendEvent({
            surface: "quick_tip",
            provider: "anthropic",
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          }),
      },
      { retries: 0 },
    )

    const tip = text.trim() || null
    return Response.json({ tip })
  } catch {
    // Fail-soft contract: any failure (model error, timeout, bad body) serves {tip:null} — the
    // overlay simply shows no tip. Never a 5xx.
    return Response.json({ tip: null })
  }
}
