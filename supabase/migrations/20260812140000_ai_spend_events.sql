-- ai_spend_events: per-call AI spend telemetry for every model call OUTSIDE the brief pipeline
-- (beta rescue Phase 2.3).
--
-- Brief builds already record token/cost telemetry into daily_briefs.brief->providerStats
-- (2026-07-16, /admin/health). Every OTHER model call in the app is invisible to us and only
-- shows up on the Anthropic/Google provider console after the fact: the /insights Priority
-- Briefing call, /api/ai/quick-tip, /api/ai/insights/generate, /api/ask, the nightly eval-judge
-- cron, the weekly ingest-knowledge-feeds cron, and the insights pipeline's own Gemini calls
-- (competitor narratives, review themes). This table is that missing ledger.
--
-- Written via lib/ai/spend-events.ts#recordSpendEvent: a fire-and-forget insert (never throws,
-- never blocks the caller) using the service-role admin client. Read by /admin/health for a
-- "non-brief AI spend (7d)" rollup by surface.
--
-- NOT billing truth (same posture as lib/ai/pricing.ts): estimated_usd is computed at write time
-- from the token counts the provider reported, using pricing.ts for Anthropic and a small Gemini
-- rate table in the recorder. The provider console remains billing truth.
--
-- RLS ENABLED, NO POLICIES: this is a service-role-only ledger (no policy = no row visible to
-- anon/authenticated; service_role bypasses RLS entirely, same posture the admin client already
-- relies on elsewhere). No end user or org-scoped surface reads this table directly.

create table if not exists public.ai_spend_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  -- Which non-brief call site this came from. Deliberately NOT a CHECK-constrained enum (mirrors
  -- insights.insight_type): new surfaces get added as call sites are instrumented, without a
  -- migration. Known values as of this table's creation: 'priority_briefing' | 'quick_tip' |
  -- 'ask' | 'eval_judge' | 'insights_generate' | 'knowledge_ingest' | 'insights_pipeline'.
  surface text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  estimated_usd numeric not null default 0,
  -- Nullable: several surfaces (eval_judge scoring a served brief, knowledge_ingest, an
  -- unauthenticated/location-less quick-tip) have no single location to attribute to.
  location_id uuid null references public.locations(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint ai_spend_events_provider_check check (provider = any (array['anthropic'::text, 'gemini'::text]))
);

create index if not exists ai_spend_events_created_at_idx on public.ai_spend_events (created_at);
create index if not exists ai_spend_events_surface_created_at_idx on public.ai_spend_events (surface, created_at);

alter table public.ai_spend_events enable row level security;

comment on table public.ai_spend_events is
  'Non-brief AI spend telemetry (beta rescue 2.3): one row per model call made outside the brief pipeline (which has its own telemetry in daily_briefs.brief->providerStats). Written by lib/ai/spend-events.ts#recordSpendEvent, service-role only (RLS enabled, no policies). estimated_usd is an ESTIMATE from token counts, not billing truth.';
