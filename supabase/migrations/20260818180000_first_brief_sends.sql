-- ALT-674: dedupe ledger for the "your first brief is ready" email.
--
-- Bryan received TWO first-brief emails for 407 BBQ on 2026-08-18, with two
-- different headlines. Chris almost certainly got two for Jersey Mike's on
-- 08-17: prod shows the identical pattern on both.
--
-- Cause: two brief pipeline runs for one location, from two different enqueue
-- paths with different run_ids (the worker's first-run chain, and the
-- self-healing /home enqueuer). lib/jobs/pipelines/brief.ts derives
-- `isFirstBrief` from hasAnyBrief() at the START of a run, so two overlapping
-- runs both read "no brief yet" and both send.
--
-- The enqueue race is fixed separately in the worker. This table is the
-- defence in depth: even if two brief runs ever overlap again, the email is
-- unrepeatable. Same insert-first pattern as trial_reminder_sends and
-- weekly_digest_sends, where a 23505 unique violation means "someone else
-- already took this send".
--
-- Key is (location_id, user_id): the email is once per location, and each
-- owner/admin on that location gets exactly one.

create table if not exists public.first_brief_sends (
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (location_id, user_id)
);

comment on table public.first_brief_sends is
  'ALT-674 dedupe ledger for the first-brief email (lib/jobs/pipelines/brief.ts, notify_first_brief step). PK = (location_id, user_id). Insert happens BEFORE the Resend send; a 23505 means another concurrent brief run already sent it, so skip.';

-- Service-role-only table (written exclusively by the brief pipeline). RLS on
-- with no policies = deny for anon/authenticated; the service role bypasses RLS.
alter table public.first_brief_sends enable row level security;
