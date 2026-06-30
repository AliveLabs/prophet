# Source-Quality Review Queue (ALT-172 consumption half)

Date: 2026-06-30 · Status: approved (founder) · Future upgrade: ALT-246

## Problem

The capture half of ALT-172 already ships: when an operator flags a Daily Brief play
as **"this looks wrong"**, an optional free-text note is persisted on
`play_actions` (`reason='looks_wrong'`, `note`), and the learning band routes
`dismissed:looks_wrong` as **neutral** (it's almost always a complaint about bad
third-party source data, not a model error). The insights feed has a parallel:
"this looks wrong" → `insights.status='inaccurate'`.

Nothing **reads** those signals. They are dark. This builds the consumer.

## Goal

A unified, internal, **read-only** source-quality review queue so an operator can
see flagged source data, the operator's note, the affected play/insight + location,
and — critically — **which third-party source/signal** is being flagged, with a
by-source rollup so a repeatedly-flagged source bubbles up.

## Hard constraint (non-negotiable)

This is a **data-quality loop only**. It must **never** feed back into the
recommendation model:
- No imports from / into `lib/skills/feedback-rollup.ts`.
- No reference to the band weights in `lib/skills/feedback-signals.ts`
  (`FEEDBACK_SIGNAL_MAP`, `recordPlayFeedback`, `recalibrateTolerance`, `updateWeight`).
- The page and its core module **only read**; they perform no writes.

The model-negative loop stays owned by thumbs-down + `dismissed:not_relevant`.
A unit test enforces the import-isolation + read-only invariants so a future edit
can't silently wire `looks_wrong`/`inaccurate` into the model.

## Surface

New admin page `app/admin/source-quality/page.tsx`, behind
`requirePlatformAdminContext()` (redirect non-admins), rendered inside the existing
admin shell (`app/admin/layout.tsx` provides `.ticket-admin tk-kit` + atmospheric
canvas). Nav entry added to `ADMIN_NAV` in `app/admin/admin-nav.tsx`. Self-hosted
`.sq-surface` paper ground modeled on `knowledge-review`'s `.kr-surface` (no second
`bg-atmos`/`.ticket-chrome` — the layout already provides them). All reads via
`createAdminSupabaseClient()`, wrapped in fail-soft `try/catch` (pre-migration safe).

## Data flow

Window: last **30 days**.

1. **Brief flags** — `play_actions` where `reason='looks_wrong'` and
   `updated_at >= now()-30d`. For the distinct `(location_id, date_key)` pairs, load
   `daily_briefs.brief` (one `.in` query), parse `brief.plays[]`, and resolve each
   `play_key` via the canonical `playKey()` from `lib/skills/preferences.ts` (same
   helper the capture side uses, so keys always match). From the resolved play:
   `title`, `evidenceRefs[]`, resolved `evidence[]`. Join `locations` for name/org.
   Carry the operator's `note`. A flag whose play can't be resolved (brief rebuilt /
   pruned) still appears, with title "Play no longer in brief" and no refs.

2. **Insight flags** — `insights` where `status='inaccurate'` and
   `feedback_at >= now()-30d` (fall back to `created_at` when `feedback_at` null).
   Fields: `title`, `summary`, `insight_type`, `location_id`, `competitor_id`,
   `feedback_at`. `insights.evidence` is a free-form `Record<string,unknown>`, so the
   source signal for insights is `insight_type` (no free-text note exists insight-side).

Both normalize to one shape:

```ts
type SourceQualityFlag = {
  kind: "brief_play" | "insight"
  flaggedAt: string            // ISO
  locationId: string
  locationName: string
  orgName?: string
  title: string
  note?: string                // operator free-text (brief side only)
  sources: string[]            // humanized ref/insight_type labels (humanizeRef)
  sourceFamily: string         // coarse bucket label (domainLabel of lead ref / insight_type)
  href?: string                // deep link to brief/insight when useful
}
```

## Pure core — `lib/skills/source-quality.ts`

No Supabase, fully unit-tested:
- `resolvePlayFlag(row, brief, location)` → `SourceQualityFlag` (uses `playKey()`).
- `insightFlag(row, location)` → `SourceQualityFlag`.
- `sourceFamilyOf(refsOrType)` → coarse label via `domainLabel()` (lead ref / insight_type).
- `aggregateBySource(flags)` → `SourceAggregate[]` = `{ family, count, kinds, recentNotes[] }`,
  sorted by count desc then family asc.

Reuses `evidence-format.ts` (`domainLabel`, `humanizeRef`, `dedupeRefs`) and
`preferences.ts` (`playKey`) — no new ref parser. De-jargoned labels keep the
no-internal-terms / plain-language rule (CHEF_LINGO / lintVoice) satisfied.

## Presentation — `app/admin/source-quality/components/source-quality-queue.tsx`

Server component (read-only, no client state). Header (eyebrow + h1 + plain-language
lede), a stat strip (total flags / brief flags / insight flags / sources flagged),
the **by-source rollup** (ranked rows: family · count · kinds), then the chronological
**per-flag list** as accessible cards (title, location, when, the note in quotes,
the humanized sources, deep link). `RevealOnView` for entrance (client kit component
rendered from the server page — RSC-safe). Empty state when there are no flags.
Styling in `app/admin/source-quality/source-quality.css` (`sq-*`, shared tokens).

## No migration

Read-only + windowed. No schema change. (Resolution state → ALT-246.)

## Testing

`tests/unit/source-quality.test.ts`: `sourceFamilyOf`, `aggregateBySource`,
`resolvePlayFlag` (resolved + unresolved), `insightFlag`, and the import-isolation /
read-only guard (asserts `source-quality.ts` has no `feedback-rollup`/band imports and
the page file issues no `.insert/.update/.upsert/.delete`). Gate: `npm run test:unit`
+ `npm run typecheck` (ignore the stale pass-preview-auth failure).

## Out of scope → ALT-246

Mark-resolved/triage state, resolution migration, open/resolved filter.
