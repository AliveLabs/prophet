-- Learning Spine L0 (P14) — the durable, versioned, per-skill knowledge layer + the vetted
-- external-source registry that feeds it.
--
-- WHY: today every ProducerSkill carries STATIC `knowledge` prose + a hardcoded `knowledgeVersion`
-- (lib/skills/skill-types.ts), injected verbatim into systemCached by prompt-kit.ts. That prose is
-- the FLOOR. These two tables make it the BASE layer and add DYNAMIC, distilled, gated learnings on
-- top — fed by the weekly EXTERNAL pipeline (app/api/cron/ingest-knowledge-feeds).
--
-- CARDINAL RULE: this is PURE UPSIDE + FAIL-SOFT. The loader (lib/skills/knowledge-feeds.ts) reads
-- these tables loose-typed and returns empty on ANY error (incl. the tables not existing yet), so a
-- learning-system outage can NEVER break a morning brief. Running this on prod only ADDS the ability
-- to compound — preview works today with NO migration (floor = today's static knowledge).
--
-- NOTHING reaches a prompt until status='active'. Trends INFORM, never OVERRIDE — that is enforced
-- in the prompt block + the closed allowedEvidenceRefs grounding set, which no learning may relax.

-- ── Table 1 — skill_knowledge ────────────────────────────────────────────────────────────────────
-- The heart: durable, versioned, distilled per-skill knowledge. One row = one ACTIONABLE snippet
-- (~300-500 chars of prose), never raw source text. Scoped global | org | location.
create table if not exists skill_knowledge (
  id uuid primary key default gen_random_uuid(),
  skill_id text not null,                       -- registry id, e.g. 'food-pairing'
  scope text not null default 'global'
    check (scope in ('global','org','location')),
  scope_id uuid,                                -- null for global; org_id / location_id otherwise
  learning_kind text not null
    check (learning_kind in ('external_trend','feedback_pattern','question_demand','editorial')),
  title text not null,                          -- short label (the uniqueness handle)
  snippet text not null,                        -- the ~300-500 char ACTIONABLE prose injected into the prompt
  provenance jsonb not null default '{}'::jsonb,-- {streams, sources:[{url|feed_id|sample_ids}], distilled_by, distilled_at}
  confidence smallint not null default 0
    check (confidence between 0 and 100),       -- the project's 0-100 calibration scale
  support_n integer not null default 0,         -- sample size: # corroborating sources / feedback rows / asks
  status text not null default 'candidate'
    check (status in ('candidate','shadow','active','retired')),
  knowledge_version text not null,              -- semver-ish, e.g. 'food-pairing@v1.3+f7'
  -- active_window: time-boxed trend snippets self-retire. NULL effective_to = open-ended.
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- scope_id must be present for org/location rows and absent for global rows.
  constraint skill_knowledge_scope_id_ck check (
    (scope = 'global' and scope_id is null) or (scope <> 'global' and scope_id is not null)
  )
);

-- Dedupe: one row per (skill, scope, scope_id, kind, title). scope_id is nullable, so global rows
-- (scope_id IS NULL) need a separate partial unique — NULL is never equal under a plain unique.
create unique index if not exists uq_skill_knowledge_global
  on skill_knowledge(skill_id, learning_kind, title)
  where scope = 'global';
create unique index if not exists uq_skill_knowledge_scoped
  on skill_knowledge(skill_id, scope, scope_id, learning_kind, title)
  where scope <> 'global';

-- The loader's hot path: ACTIVE rows for a skill within the active window, by scope.
create index if not exists idx_skill_knowledge_active
  on skill_knowledge(skill_id, scope, status);
create index if not exists idx_skill_knowledge_scope_id
  on skill_knowledge(scope_id) where scope_id is not null;

alter table skill_knowledge enable row level security;

-- RLS mirrors evergreen_*: global rows readable by ANY authenticated user; org/location rows scoped
-- by membership. WRITES are service-role only (the cron + promotion paths bypass RLS).
create policy "global skill_knowledge readable by all"
  on skill_knowledge for select
  using (scope = 'global' and auth.role() = 'authenticated');

create policy "org members can read org-scoped skill_knowledge"
  on skill_knowledge for select
  using (
    scope = 'org' and exists (
      select 1 from organization_members m
      where m.organization_id = skill_knowledge.scope_id and m.user_id = auth.uid()
    )
  );

create policy "org members can read location-scoped skill_knowledge"
  on skill_knowledge for select
  using (
    scope = 'location' and exists (
      select 1 from locations l
      join organization_members m on m.organization_id = l.organization_id
      where l.id = skill_knowledge.scope_id and m.user_id = auth.uid()
    )
  );

-- ── Table 3 — skill_source_registry ──────────────────────────────────────────────────────────────
-- Vetted external sources. Promotes docs/engine-rewrite/p9-curated-sources.md from a markdown seed
-- into a managed table. PIPELINE 1's hard gate (a): a source MUST be in this registry with a
-- trust_tier + enabled — NO open-web ingestion, ever.
create table if not exists skill_source_registry (
  id uuid primary key default gen_random_uuid(),
  skill_ids text[] not null default '{}',       -- a source can feed several, e.g. NRA What's Hot → food-pairing + marketing
  name text not null,
  vertical text not null,                        -- domain label: industry | culinary | marketing | operations | positioning | reputation | local-demand
  url text not null,                             -- listing/feed/article-index URL
  fetch_strategy text not null default 'scrape'
    check (fetch_strategy in ('rss','scrape','scrape-browser-headers','data-api')),
  auth_kind text not null default 'none'
    check (auth_kind in ('none','free-token','paid')),
  trust_tier smallint not null default 2
    check (trust_tier in (1,2,3)),
  enabled boolean not null default true,
  last_fetch timestamptz,
  last_status text,                              -- 'ok' | 'http_403' | 'fetch_error' | 'no_items' | 'disabled-auth' ...
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (url)
);

create index if not exists idx_skill_source_registry_enabled
  on skill_source_registry(enabled) where enabled;

alter table skill_source_registry enable row level security;

-- Reference data, not tenant data: readable by any authenticated user (so an admin UI can list it);
-- writes are service-role only (the cron updates last_fetch / failure_count via the service role).
create policy "authenticated can read skill_source_registry"
  on skill_source_registry for select
  using (auth.role() = 'authenticated');

-- ── SEED — skill_source_registry from p9-curated-sources.md PRIORITY-1 set ─────────────────────────
-- v1 seeds the FREE / RSS / scrapeable sources only (auth_kind='none'). Paid/free-token sources are
-- recorded DISABLED with their auth_kind so they are managed (not ingested) until Bryan flips a key:
--   • PredictHQ (paid)  → enabled=false, auth_kind='paid'
--   • NOAA NCEI CDO (free token) → enabled=false, auth_kind='free-token'
-- BLS API works keyless (key only raises rate limits) → seeded enabled, auth_kind='none'.
-- idempotent: ON CONFLICT (url) keeps the row (so re-running never duplicates or clobbers tuning).
insert into skill_source_registry (skill_ids, name, vertical, url, fetch_strategy, auth_kind, trust_tier, enabled)
values
  -- Tier 1, free, no key — the v1 active set.
  ('{"food-pairing","marketing"}', 'NRA Restaurant Economic Insights', 'industry',
    'https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/', 'scrape', 'none', 1, true),
  ('{"positioning","marketing"}', 'NRA Menu Prices Economic Indicator', 'positioning',
    'https://restaurant.org/research-and-media/research/economists-notebook/economic-indicators/menu-prices/', 'scrape', 'none', 1, true),
  ('{"operations","local-demand"}', 'BLS Food Services & Drinking Places (NAICS 722)', 'operations',
    'https://api.bls.gov/publicAPI/v2/timeseries/data/CES7072200001', 'data-api', 'none', 1, true),
  ('{"food-pairing","marketing"}', 'NRA What''s Hot Culinary Forecast', 'culinary',
    'https://restaurant.org/research-and-media/research/whats-hot/', 'scrape', 'none', 1, true),
  ('{"marketing","positioning"}', 'Modern Restaurant Management', 'positioning',
    'https://modernrestaurantmanagement.com/feed/', 'rss', 'none', 2, true),
  ('{"marketing","food-pairing"}', 'Nation''s Restaurant News — Menu & Marketing', 'marketing',
    'https://www.nrn.com/rss.xml', 'rss', 'none', 2, true),
  ('{"operations"}', 'QSR Magazine', 'operations',
    'https://www.qsrmagazine.com/rss.xml', 'scrape-browser-headers', 'none', 2, true),
  ('{"reputation"}', 'Birdeye — State of Online Reviews', 'reputation',
    'https://birdeye.com/resources/', 'scrape', 'none', 2, true),
  ('{"marketing","food-pairing"}', 'Black Box Intelligence — In Review', 'industry',
    'https://blackboxintelligence.com/blog/', 'scrape', 'none', 1, true),
  ('{"operations","marketing"}', 'Toast — Restaurant Trends Report', 'operations',
    'https://pos.toasttab.com/blog', 'scrape', 'none', 2, true),
  -- Key-gated — seeded DISABLED + tagged with auth_kind so they are managed, never auto-ingested.
  ('{"local-demand"}', 'PredictHQ Demand Intelligence & Events API', 'local-demand',
    'https://control.predicthq.com/', 'data-api', 'paid', 1, false),
  ('{"local-demand"}', 'NOAA NCEI Climate Data Online (CDO) API', 'local-demand',
    'https://www.ncei.noaa.gov/cdo-web/api/v2/data', 'data-api', 'free-token', 1, false),
  ('{"social-counter","marketing"}', 'Modern Restaurant Management — Social', 'marketing',
    'https://modernrestaurantmanagement.com/category/marketing/feed/', 'rss', 'none', 2, true)
on conflict (url) do nothing;
