# Phase 0 — Vercel Workflow Spike (fit assessment, 2026-06-04)

> The plan makes the async substrate the riskiest unknown. This spike answers **"does Vercel Workflow
> (WDK) actually fit our gather → fan-out → synthesize shape?"** without committing a heavy dependency
> before the team greenlights it. Grounded in the *current* WDK API (bundled docs / skill) + our real
> pipeline code. The one thing this spike defers is the **live run**, which needs the Supabase branch +
> secrets (see the runbook at the end) — best done when Bryan is around.

## Verdict: it fits, with three concrete constraints

WDK maps cleanly onto our pipeline. The orchestrator (`"use workflow"`) does pure control flow; every I/O
unit (`"use step"`) has full Node access, auto-retry, and replay-cached results. Our `refresh-all` is
already a list of isolated steps, so the conversion is mechanical. **Recommend proceeding** — but install
+ live-verify together (below), because the value (Phase 1 brief) does not depend on this and we keep the
Fluid-Compute fallback in our back pocket.

## How our pipeline maps

Today (`lib/jobs/pipeline.ts` + `lib/jobs/pipelines/refresh-all.ts`): a cron route fires a fire-and-forget
`fetch(/api/jobs/refresh_all)`; `runPipeline` runs 7 sub-pipelines **sequentially** in one **300s** request;
a `refresh_jobs` "running" row is hand-managed and **orphans on timeout**.

Target:

```ts
// lib/workflows/refresh-and-brief.ts
export async function refreshAndBriefWorkflow(locationId: string, organizationId: string, dateKey: string) {
  "use workflow"                              // sandboxed: orchestration only, no I/O
  await gatherContent(locationId, organizationId, dateKey)   // each = "use step" (full Node)
  await gatherVisibility(locationId, organizationId, dateKey)
  // ...the rest of the 7 gather pipelines...
  await buildDossier(locationId, dateKey)                    // persists the dossier (see constraint #2)
  const plays = await Promise.all(                           // FAN-OUT: parallel skill steps
    SKILL_IDS.map((id) => runSkill(id, locationId, dateKey)) // each "use step", catches its own errors
  )
  await synthesize(locationId, dateKey)                      // "use step"
  await voiceAndPersist(locationId, dateKey)                 // "use step"
}
```

Cron route stops the fire-and-forget fetch and calls `start(refreshAndBriefWorkflow, [locationId, orgId, dateKey])`
(returns immediately, no 300s hold). Each existing sub-pipeline's body becomes a step; the insight skill
fan-out becomes `Promise.all` of step calls.

## Three constraints the spike caught (all addressable)

1. **The Supabase client is NOT serializable — stop threading it through `ctx`.** WDK passes only
   serializable values between workflow/steps (plain objects, arrays, Date, etc.; **no class instances**).
   Today every step receives `ctx.supabase` (a `createClient()` instance, `lib/supabase/admin.ts` /
   `lib/jobs/manager.ts:13`). Fix: **steps construct their own admin client internally** via the existing
   `createAdminSupabaseClient()`; only IDs (`locationId`, `organizationId`, `dateKey`) cross step
   boundaries. Small, mechanical refactor of the `buildCtx` pattern.

2. **Pass keys, not fat objects, between steps.** The dossier (all signals + 76 rule outputs) can be large.
   Even though it's serializable, persist it (a `brief_stage_cache` row keyed `(locationId, dateKey)`) and
   pass the **key**, not the object, between steps. This sidesteps any step-payload size limit (exact limit
   TBD — confirm at install) and doubles as the idempotency/cost cache the plan already calls for.

3. **`Promise.all` fan-out requires steps that don't throw.** `Promise.all` rejects on the first throw, which
   would abort the brief. Each `runSkill` step must **catch internally and return `{ skillId, status }`**
   (mirrors today's per-step warning isolation in `runPipeline`), so one failing skill degrades the brief
   instead of killing it. Use `RetryableError` (429/5xx) and `FatalError` (bad config) inside steps for the
   built-in retry behavior.

## What WDK gives us for free (vs the hand-rolled runner)

- **De-orphan:** the workflow engine owns run lifecycle, so no more `refresh_jobs` row stuck in "running"
  after a timeout. Keep `refresh_jobs` as a thin status mirror or replace with `npx workflow inspect`.
- **No 300s wall:** steps are individually durable/checkpointed; the long photo/synthesis work no longer
  has to finish inside one request.
- **Retries + replay:** per-step automatic retry; completed steps return cached results on replay.
- **Local dev / testing:** `npx workflow health | web | inspect runs` for visibility; `@workflow/vitest`
  plugin for integration tests (separate config). Crucially, **`"use step"` is a no-op without the
  compiler, so steps are plain functions in unit tests** — our existing deterministic rule tests AND the
  new Phase B eval checks keep running unchanged.

## Fallback (if the live run surfaces a blocker)

Same DAG on the existing `runPipeline`, triggered by a Vercel Cron background route on **Fluid Compute**
(lifts `maxDuration` well past 300s), using the `refresh_jobs` table as the queue (it's already 80% of one).
"Async + de-orphan" is thus achievable even if "Vercel Workflow specifically" doesn't pan out — they are
separable decisions, and Phase 1 value never blocks on this.

## Open items to confirm at install (need the live env)

- Exact **step-payload size limit** (design already avoids it via constraint #2).
- **`withWorkflow`** wiring in `next.config` + any Vercel project settings.
- Whether the AI skill steps use plain provider calls or `DurableAgent` from `@workflow/ai` (Phase 2 decision).

## Live-spike runbook (gated on Bryan's env + greenlight)

1. `npm i workflow` (+ `@workflow/ai` if using `DurableAgent`); add `withWorkflow` to `next.config`.
2. Convert **ONE** sub-pipeline (recommend `visibility` — no Gemini Vision, moderate duration) into a
   `"use step"`, with the client built inside it (constraint #1).
3. Add a tiny `refreshAndBriefWorkflow` that runs just that one step; trigger via `start()` from a temp
   route or `npx`.
4. Run against the Supabase branch `eguflqjnodumjbmdxrnj` for a location with **3-5 competitors**
   (`anand@alivemethod.com` / Wagyu House).
5. **Pass criteria:** completes with **no 300s timeout**, **no orphaned `running` row**, and
   `npx workflow inspect run <id>` shows clean step lifecycle. Then convert the remaining sub-pipelines.

## Status
Fit assessment: **PASS (proceed)**. Code/authoring model validated against the current WDK API + our
pipeline. Live run + install pending Bryan's greenlight and env (the spike's only remaining unknown).
