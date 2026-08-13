-- Weekly-digest scheduling plumbing (beta rescue D6). Ships with PR
-- feat/phase3-nurture-digest; NOT applied by that PR -- promotion happens in a
-- reviewed batch. Sends stay gated behind WEEKLY_DIGEST_EMAILS_ENABLED
-- regardless of this migration.

-- Per-USER preferred digest day (D6 ruling): 0=Sunday .. 6=Saturday, JS Date
-- convention (matches lib/email/digest-schedule.ts). Default Monday --
-- operators are often closed Mondays, so the digest lands on their admin day.
alter table public.profiles
  add column if not exists weekly_digest_day smallint not null default 1;

alter table public.profiles
  add constraint profiles_weekly_digest_day_chk
  check (weekly_digest_day between 0 and 6);

comment on column public.profiles.weekly_digest_day is
  'Preferred weekly-digest weekday, 0=Sun..6=Sat (JS convention). Default 1 (Monday). Read by /api/cron/weekly-digest; set from /settings#weekly-digest.';

-- Dedupe log for /api/cron/weekly-digest (the trial_reminder_sends pattern):
-- the cron runs hourly with a catch-up window, and the insert happens BEFORE
-- the Resend send, so a retried tick can never double-email. date_key is the
-- recipient's LOCAL calendar date (YYYY-MM-DD in the location's timezone).
create table if not exists public.weekly_digest_sends (
  user_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  date_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, location_id, date_key)
);

comment on table public.weekly_digest_sends is
  'Dedupe log for /api/cron/weekly-digest. PK = (user_id, location_id, local date_key). Insert happens before the Resend send.';

-- Service-role-only table (written exclusively by the cron). RLS on with no
-- policies = deny for anon/authenticated; service role bypasses RLS.
alter table public.weekly_digest_sends enable row level security;
