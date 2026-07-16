-- Review Intelligence (ALT-351) — operator-set generosity threshold.
-- Mirrors the brand_tolerance pattern (20260604120000_daily_briefs.sql): a dedicated
-- typed column on locations, 0-100, edited via a Settings slider island + user-scoped
-- server action (setGenerosityThreshold), read by lib/reviews/make-good.ts when mapping
-- a scored review to a recommended action tier (respond | discount | comp).
--
-- Origin: the operator's own "thermometer" concept (Bush's Chicken demo 2026-07-15) —
-- how heated does a complaint have to be before you offer a discount or give money
-- back. The OWNER decides where that line sits; Ticket only recommends, never executes
-- a make-good. 0 = respond-first posture (never suggest give-aways), 100 = generous.
-- Default 40 = conservative-leaning (Bryan to confirm — see the feature DECISIONS doc).
--
-- Additive + defaulted ⇒ fail-soft: existing rows get the default; pre-migration reads
-- fall back to the same constant in code (GENEROSITY_DEFAULT in lib/reviews/make-good.ts).

alter table public.locations
  add column if not exists generosity_threshold integer not null default 40;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'locations_generosity_threshold_check'
  ) then
    alter table public.locations
      add constraint locations_generosity_threshold_check
      check (generosity_threshold between 0 and 100);
  end if;
end $$;

comment on column public.locations.generosity_threshold is
  'ALT-351 — operator''s make-good posture for review responses, 0 (respond-only) .. 100 (generous). Consumed by lib/reviews/make-good.ts to place the discount/comp cut-points. Recommendation-only: Ticket never executes a make-good.';
