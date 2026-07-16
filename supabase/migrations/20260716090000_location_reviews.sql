-- Review Intelligence (ALT-347) — persist individual customer reviews.
-- Until now, reviews were fetched live from Google Places, distilled into aggregate
-- themes (location_snapshots provider='review_sentiment'), and DISCARDED — no per-review
-- rows, no reviewer identity, no absolute timestamps. This table makes each review a
-- first-class record so the Review Intelligence surface (authenticity + severity +
-- triage + response drafts, ALT-348..355) has something to stand on.
--
-- Data source is unchanged: the same Google Places details call already returns the
-- full review objects (stable resource `name`, absolute `publishTime`, authorAttribution,
-- googleMapsUri) — the old normalizers just dropped those fields. No new external calls.
-- Places returns ~5 reviews per fetch; rows ACCUMULATE across daily builds via upsert,
-- so the corpus grows over time (last_seen_at tracks continued presence in the feed).
--
-- Scoring columns are NULL until the scoring pass (lib/reviews/scoring.ts) runs — the
-- pass is fail-soft and never fabricates: on failure rows simply stay unscored and the
-- UI renders them neutrally. score_version lets a smarter pass re-score old rows
-- differentially.
--
-- GUARDRAIL (Bryan, 2026-07-16): authenticity/severity exist to prioritize and improve
-- RESPONSES. Nothing in this system recommends review removal or coaches removal-gaming.
--
-- Upsert key: (location_id, source, source_review_id) — all three NOT NULL, plain
-- NON-partial unique constraint, so it is a valid supabase-js onConflict target (see the
-- partial-index 42P10 gotcha that silently no-op'd the spine upserts).
--
-- RLS mirrors the repo split: engine writes via service role (bypasses RLS); org members
-- read their locations' reviews and update triage/verdict state via user-scoped server
-- actions (column discipline enforced at the action layer, same as play_actions).

create table if not exists public.location_reviews (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  source text not null default 'google_places',
  source_review_id text not null,            -- Google review resource name (stable id)
  author_name text,                          -- authorAttribution.displayName
  author_key text,                           -- reviewer identity for within-our-data
                                             -- aggregates: authorAttribution.uri when
                                             -- present (contributor URL, stable-ish),
                                             -- else normalized display name
  rating integer check (rating between 1 and 5),
  review_text text,
  published_at timestamptz,                  -- absolute publishTime (finally)
  relative_published text,                   -- Google's "3 weeks ago" (display fallback)
  google_maps_uri text,                      -- deep link to the review (respond in Google)
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- scoring (ALT-348/350) — NULL until scored; never defaulted, never fabricated
  authenticity_score integer check (authenticity_score between 0 and 100),
  authenticity_confidence text check (authenticity_confidence in ('low','medium','high')),
  authenticity_rationale text,
  severity_score integer check (severity_score between 0 and 100),
  severity_rationale text,
  red_flags jsonb,                           -- string[] of matched red-flag categories
  scored_at timestamptz,
  score_version text,

  -- triage state (ALT-353/355) — operator-facing workflow state, written via
  -- user-scoped server actions. TRIAGE STATE ONLY: never read by
  -- lib/skills/feedback-rollup.ts, never feeds the band weights (same hard
  -- constraint as the ALT-246 source-quality columns).
  triage_status text not null default 'open' check (triage_status in ('open','responded','dismissed')),
  triage_updated_at timestamptz,
  triage_updated_by uuid references auth.users(id),
  operator_verdict text check (operator_verdict in ('genuine','not_genuine')),
  operator_verdict_at timestamptz,

  -- response draft (ALT-354) — operator-initiated, operator-sent. Ticket never posts.
  draft_text text,
  draft_generated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_reviews_source_key unique (location_id, source, source_review_id)
);

-- Triage surface read path: open items first, most severe first, fresh first.
create index if not exists idx_location_reviews_triage
  on public.location_reviews (location_id, triage_status, severity_score desc nulls last, published_at desc nulls last);
-- Scoring pass read path: unscored rows per location (partial index is fine for
-- SELECT — the 42P10 gotcha applies only to ON CONFLICT targets).
create index if not exists idx_location_reviews_unscored
  on public.location_reviews (location_id) where scored_at is null;
-- Reviewer aggregates (within-our-data signals, ALT-349).
create index if not exists idx_location_reviews_author
  on public.location_reviews (location_id, author_key);

alter table public.location_reviews enable row level security;

drop policy if exists "org members read location_reviews" on public.location_reviews;
create policy "org members read location_reviews"
  on public.location_reviews for select
  using (exists (
    select 1
    from public.locations l
    join public.organization_members m on m.organization_id = l.organization_id
    where l.id = location_reviews.location_id
      and m.user_id = auth.uid()
  ));

-- Members update triage/verdict/draft state on their own locations' reviews (the
-- server actions are the write surface; engine/scoring writes use the service role).
drop policy if exists "org members update location_reviews" on public.location_reviews;
create policy "org members update location_reviews"
  on public.location_reviews for update
  using (exists (
    select 1
    from public.locations l
    join public.organization_members m on m.organization_id = l.organization_id
    where l.id = location_reviews.location_id
      and m.user_id = auth.uid()
  ));

comment on table public.location_reviews is
  'Review Intelligence (ALT-347): one row per customer review seen in the Google Places feed for an OWN location. Accumulates across daily builds (upsert on location_id/source/source_review_id). Scoring columns null until lib/reviews/scoring.ts runs.';
comment on column public.location_reviews.author_key is
  'Reviewer identity for within-our-data aggregates (ALT-349): authorAttribution.uri when present, else normalized display name. NOT a cross-platform identity.';
comment on column public.location_reviews.triage_status is
  'Operator triage state (open|responded|dismissed). TRIAGE ONLY — never feeds feedback-rollup/band weights.';
comment on column public.location_reviews.operator_verdict is
  'Operator''s genuineness call on a review (genuine|not_genuine). Provisional learning signal captured via lib/reviews/review-signals.ts; adjusts display immediately.';
