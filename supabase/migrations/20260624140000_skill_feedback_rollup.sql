-- Learning Spine L1 (P15) — skill_feedback_rollup: the DISTILLED click-feedback signal per skill.
--
-- This is NOT raw events (those stay in brief_feedback / play_actions). It is the nightly-recomputed
-- rollup: one row per (skill_id, scope, scope_id, play_type_key), carrying the Bayesian-smoothed
-- liked-rate and a CLAMPED 0.7–1.3 scoring multiplier the synthesizer applies ALONGSIDE the category
-- prior. play_type_key = the P10 stable, low-cardinality descriptor (skillId|kind|leadDomain|sevBand),
-- computed by lib/skills/preferences.ts#computePlayTypeKey.
--
-- CARDINAL RULE: PURE UPSIDE + FAIL-SOFT. The loader (lib/skills/feedback-rollup.ts) reads this table
-- loose-typed and returns the NEUTRAL multiplier 1.0 on ANY error (incl. the table not existing yet,
-- or support_n below the gate) — so a learning-system outage can NEVER move a brief, and an EMPTY
-- table leaves synthesis ranking byte-identical to today. Running this on prod only ADDS the ability
-- to compound. Preview works today with NO migration (floor = today's ranking).
--
-- GUARDRAILS (§2.2) the rollup write enforces (this table just persists the result):
--   (a) support_n gate     — a row below the min support_n yields multiplier 1.0 (one rage-clicker
--                            can't move ranking); the loader treats it as neutral.
--   (b) severity-aware     — severity rides the play_type_key (sevBand), so adventurous vs on-brand
--                            variants aggregate separately and only consistent patterns distill.
--   (c) confounder guard   — a GLOBAL-scope row requires MULTIPLE orgs (org_support_n); else the
--                            pattern stays org/location-scoped. Enforced in the rollup, recorded here.
--   (d) multiplier clamp   — 0.7..1.3, so the rollup only NUDGES; per-location brand_tolerance +
--                            operator category-priors stay DOMINANT (popularity-collapse guard).
--
-- DO NOT RUN FROM THE AGENT SHELL. Bryan runs this against prod (triodvdspdsuudooyura), NOT the stale
-- eguflqjnodumjbmdxrnj.

create table if not exists skill_feedback_rollup (
  id uuid primary key default gen_random_uuid(),
  skill_id text not null,                         -- registry id, e.g. 'food-pairing' (keyed BY skill)
  scope text not null default 'global'
    check (scope in ('global','org','location')),
  scope_id uuid,                                  -- null for global; org_id / location_id otherwise
  play_type_key text not null,                    -- P10 stable low-cardinality key: skillId|kind|leadDomain|sevBand

  -- Signal counts. These are WEIGHTED by the feedback-signals band (weight × confidence), so a thumb
  -- contributes ~1.0 and a directional save/dismiss contributes a fraction. Stored as numeric, not
  -- integer, because the band weights are fractional.
  good_count numeric not null default 0,          -- band-weighted positive mass
  bad_count numeric not null default 0,           -- band-weighted negative mass
  -- Severity-weighted sums: the same mass, scaled by the play's severity band, so the rollup can see
  -- whether a pattern holds across severity bands (severity-aware distillation, guardrail (b)).
  good_weighted numeric not null default 0,
  bad_weighted numeric not null default 0,

  bayes_score numeric not null default 0.5,       -- smoothed liked-rate in [0,1] (small-N → ~prior 0.5)
  multiplier numeric not null default 1.0          -- the served nudge, CLAMPED 0.7..1.3
    check (multiplier between 0.7 and 1.3),
  support_n integer not null default 0,           -- effective sample size (count of contributing rows)
  -- Confounder guard (c): # distinct orgs contributing to a GLOBAL row. A global pattern requires
  -- this to be >= the multi-org floor; otherwise the rollup keeps the pattern org/location-scoped.
  org_support_n integer not null default 0,

  last_recompute timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- scope_id present for org/location rows, absent for global (mirrors skill_knowledge).
  constraint skill_feedback_rollup_scope_id_ck check (
    (scope = 'global' and scope_id is null) or (scope <> 'global' and scope_id is not null)
  )
);

-- Dedupe: one row per (skill, scope, scope_id, play_type_key). scope_id is nullable, so global rows
-- (scope_id IS NULL) need a separate partial unique — NULL is never equal under a plain unique.
-- These are the ON CONFLICT targets the nightly rollup upserts against (idempotent recompute).
create unique index if not exists uq_skill_feedback_rollup_global
  on skill_feedback_rollup(skill_id, play_type_key)
  where scope = 'global';
create unique index if not exists uq_skill_feedback_rollup_scoped
  on skill_feedback_rollup(skill_id, scope, scope_id, play_type_key)
  where scope <> 'global';

-- The loader's hot path: rows for a skill by scope (it fetches all and partitions client-side).
create index if not exists idx_skill_feedback_rollup_skill_scope
  on skill_feedback_rollup(skill_id, scope);
create index if not exists idx_skill_feedback_rollup_scope_id
  on skill_feedback_rollup(scope_id) where scope_id is not null;

alter table skill_feedback_rollup enable row level security;

-- RLS mirrors skill_knowledge: global rows readable by ANY authenticated user; org/location rows
-- scoped by membership. WRITES are service-role only (the nightly rollup cron bypasses RLS).
create policy "global skill_feedback_rollup readable by all"
  on skill_feedback_rollup for select
  using (scope = 'global' and auth.role() = 'authenticated');

create policy "org members can read org-scoped skill_feedback_rollup"
  on skill_feedback_rollup for select
  using (
    scope = 'org' and exists (
      select 1 from organization_members m
      where m.organization_id = skill_feedback_rollup.scope_id and m.user_id = auth.uid()
    )
  );

create policy "org members can read location-scoped skill_feedback_rollup"
  on skill_feedback_rollup for select
  using (
    scope = 'location' and exists (
      select 1 from locations l
      join organization_members m on m.organization_id = l.organization_id
      where l.id = skill_feedback_rollup.scope_id and m.user_id = auth.uid()
    )
  );
