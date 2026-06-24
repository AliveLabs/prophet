-- Learning Spine — FIX the silently-failing upserts (skill_knowledge + skill_feedback_rollup).
--
-- WHY (confirmed via a live prod run + DB inspection): EVERY learning-spine upsert was SILENTLY
-- FAILING, so both tables stayed EMPTY and the learning loop could never compound. Root cause:
--
--   • Both tables dedupe with PARTIAL unique indexes — one WHERE scope='global' (so two global rows,
--     whose scope_id IS NULL, collide despite NULL <> NULL under a plain unique) and one
--     WHERE scope<>'global' for the scoped rows.
--   • The writers use supabase-js `.upsert(payload, { onConflict: "cols" })`. PostgREST turns that into
--     `INSERT ... ON CONFLICT (cols) DO UPDATE`, and Postgres requires the ON CONFLICT column list to
--     match a NON-partial unique/exclusion constraint. It CANNOT target a PARTIAL index → Postgres
--     raises 42P10 "no unique or exclusion constraint matching the ON CONFLICT specification".
--   • The writer code SWALLOWED that error (`if (!upErr) result.rowsWritten += ...`), so each run
--     reported success (HTTP 200, distilledKept>0) while writing ZERO rows.
--
-- THE FIX (PostgreSQL 15+, prod is 17.6): replace each PAIR of partial indexes with ONE NON-partial
-- unique index over the FULL tuple, declared `NULLS NOT DISTINCT`. NULLS NOT DISTINCT makes two NULLs
-- compare EQUAL for uniqueness, so:
--   • global rows (scope='global', scope_id IS NULL) dedupe on the same tuple as scoped rows — two
--     global rows with the same (skill_id, …, title/play_type_key) now COLLIDE and upsert in place;
--   • scoped rows (scope_id set) dedupe on the full tuple exactly as before.
-- A single NON-partial index CAN be an ON CONFLICT target via PostgREST, so the upserts stop erroring.
-- The writer onConflict tuples are updated to match this index in the same change.
--
-- SAFETY: both tables are EMPTY in prod (that is the bug — nothing was ever written), so dropping +
-- recreating the dedupe index needs NO backfill and can raise NO unique-violation. The scope_id CHECK
-- constraints (…_scope_id_ck: scope='global' ⇒ scope_id IS NULL) are UNCHANGED and stay valid — global
-- rows keep scope_id NULL, which is exactly what NULLS NOT DISTINCT dedupes on.
--
-- DO NOT RUN FROM THE AGENT SHELL. Bryan runs this against prod (triodvdspdsuudooyura), NOT the stale
-- eguflqjnodumjbmdxrnj. This migration only ADDS the ability to compound; the loaders stay fail-soft.

-- ── skill_knowledge — one non-partial dedupe index over the full tuple ──────────────────────────────
-- Replaces uq_skill_knowledge_global (partial, WHERE scope='global') +
--          uq_skill_knowledge_scoped (partial, WHERE scope<>'global').
drop index if exists uq_skill_knowledge_global;
drop index if exists uq_skill_knowledge_scoped;

create unique index if not exists uq_skill_knowledge_dedupe
  on skill_knowledge (skill_id, scope, scope_id, learning_kind, title)
  nulls not distinct;

-- ── skill_feedback_rollup — one non-partial dedupe index over the full tuple ────────────────────────
-- Replaces uq_skill_feedback_rollup_global (partial, WHERE scope='global') +
--          uq_skill_feedback_rollup_scoped (partial, WHERE scope<>'global').
drop index if exists uq_skill_feedback_rollup_global;
drop index if exists uq_skill_feedback_rollup_scoped;

create unique index if not exists uq_skill_feedback_rollup_dedupe
  on skill_feedback_rollup (skill_id, scope, scope_id, play_type_key)
  nulls not distinct;
