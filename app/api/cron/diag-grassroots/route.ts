// ---------------------------------------------------------------------------
// GET /api/cron/diag-grassroots?location_id=... — ⚠️ TEMPORARY DIAGNOSTIC (remove after).
// Runs the grassroots skill for ONE location and reports exactly WHERE its plays die:
// raw model count → coerce → each parse gate (signal / generic / anchor) → grounded-ref filter.
// Read-only (no writes). Auth: Bearer CRON_SECRET (mirrors the other crons).
// Built 2026-06-25 to diagnose "grassroots produces 0 surviving plays". DELETE when done.
// ---------------------------------------------------------------------------

import { buildDossier } from "@/lib/insights/dossier/build"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import {
  guerrillaMarketingSkill,
  isGrassrootsSignal,
  isGenericAdvice,
  namesAnAnchor,
} from "@/lib/skills/guerrilla-marketing/skill"
import { coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { claudeRaw, extractJson } from "@/lib/ai/provider"
import { loadActiveKnowledge } from "@/lib/skills/knowledge-feeds"

export const maxDuration = 300

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  const locationId = new URL(req.url).searchParams.get("location_id")
  if (!locationId) return Response.json({ error: "location_id required" }, { status: 400 })

  try {
    const dossier = await buildDossier(locationId)
    const index = buildRefIndex(dossier)
    const allowedGrassrootsRefs = [...index.allowedRefs].filter(isGrassrootsSignal)

    const knowledge = guerrillaMarketingSkill.learning
      ? await loadActiveKnowledge(
          guerrillaMarketingSkill.id,
          { locationId, organizationId: null },
          { acceptedKinds: guerrillaMarketingSkill.learning.acceptedLearningKinds },
        )
      : { global: [], scoped: [], globalVersion: "" }
    const { systemCached, system, prompt } = guerrillaMarketingSkill.buildPrompt(dossier, knowledge)

    const maxOutputTokens = Number(new URL(req.url).searchParams.get("max_tokens")) || 16000
    // Call the model DIRECTLY (not via generateStructured) so we capture the raw TEXT + any API error.
    let rawText = ""
    let rawErr: string | null = null
    try {
      rawText = await claudeRaw({ tier: guerrillaMarketingSkill.tier, systemCached, system, prompt, temperature: guerrillaMarketingSkill.temperature, thinking: true, effort: "medium", maxOutputTokens })
    } catch (e) {
      rawErr = e instanceof Error ? e.message : String(e)
    }
    const raw = rawText ? extractJson(rawText) : null
    const postParse = guerrillaMarketingSkill.parse(raw, dossier) ?? []

    const coerced =
      coerceEnrichedPlays(raw, { skillId: "guerrilla-marketing", knowledgeVersion: "diag", defaultKind: "capitalize", defaultOwner: "marketing" }) ?? []

    const breakdown = coerced.map((p) => {
      const text = `${p.title} ${p.rationale} ${(p.recipe ?? []).map((s) => `${s.audience ?? ""} ${s.channel ?? ""} ${s.offer ?? ""} ${s.copy ?? ""}`).join(" ")}`
      return {
        title: p.title,
        evidenceRefs: p.evidenceRefs,
        gate_groundsOnGrassrootsSignal: (p.evidenceRefs ?? []).some(isGrassrootsSignal),
        gate_notGeneric: !isGenericAdvice(text),
        gate_namesAnchor: namesAnAnchor(p, dossier),
        grounded_refsAllowed: (p.evidenceRefs ?? []).length > 0 && (p.evidenceRefs ?? []).every((r) => index.allowedRefs.has(r)),
      }
    })

    return Response.json({
      locationId,
      partnerEntities: dossier.partnerEntities?.length ?? 0,
      datedEvents: dossier.demandCalendar?.events?.length ?? 0,
      allowedGrassrootsRefs,
      activeKnowledge: knowledge.global.length + knowledge.scoped.length,
      maxOutputTokens,
      rawErr,
      rawTextLength: rawText.length,
      rawTextHead: rawText.slice(0, 1400),
      rawTextTail: rawText.slice(-700),
      extractJsonType: raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw,
      extractJsonKeys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw as object) : undefined,
      rawCount: Array.isArray(raw) ? raw.length : ((raw as { plays?: unknown[] })?.plays?.length ?? null),
      coercedCount: coerced.length,
      postParseCount: postParse.length,
      postParseTitles: postParse.map((p) => p.title),
      breakdown,
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "diag failed", stack: err instanceof Error ? err.stack : undefined })
  }
}
