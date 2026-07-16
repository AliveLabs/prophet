-- Review Intelligence v2 (ALT-359) — sentiment as its own scored axis.
-- Bryan's 2026-07-17 review: "how serious" read like an escalation level and made
-- positive reviews look weird ("Mild"). The card now plots a SENTIMENT spectrum
-- (extreme negative .. extreme positive) with a position marker; severity_score
-- stays (it still drives crisis routing + make-good sizing), sentiment drives
-- the spectrum bar and the list's band-then-date ordering.
--
-- Scored by the ri-v2 pass in lib/reviews/scoring.ts (-100 = furious/hostile,
-- 0 = neutral, +100 = delighted). NULL until (re)scored — bumping the score
-- version re-scores the corpus differentially. Text-less reviews stay NULL and
-- the UI falls back to a star-anchored marker.
--
-- ENGINE-OWNED column: deliberately NOT added to the authenticated column-grant
-- lists from 20260716090000 (grants are per-column, so members simply have no
-- UPDATE/INSERT privilege on it; service role only).

alter table public.location_reviews
  add column if not exists sentiment_score integer;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'location_reviews_sentiment_score_check'
  ) then
    alter table public.location_reviews
      add constraint location_reviews_sentiment_score_check
      check (sentiment_score between -100 and 100);
  end if;
end $$;

comment on column public.location_reviews.sentiment_score is
  'ALT-359 — model-read sentiment of the review, -100 (furious/hostile) .. 0 (neutral) .. 100 (delighted). Drives the sentiment spectrum bar + list ordering. NULL until scored by lib/reviews/scoring.ts (ri-v2+); engine-owned (service-role writes only).';
