-- ALT-695 — let `beta_feedback` hold a request from someone who is NOT signed in.
--
-- The locked-out operator is a real support case and currently the least able to reach us: the app
-- subdomain redirects / to /login, and the only inbound channel is a mailto. So the support form
-- needs a door that works with no session, and it writes to the same table so there is ONE queue
-- and ONE Notion pipeline rather than a second inbound channel to keep in sync.
--
-- Reusing the table rather than creating `support_requests` is deliberate: the Notion sync cron
-- (app/api/cron/feedback-notion-sync) and its retry sweeper already read this table, and its select
-- types already treat user_id and organization_id as nullable. A new table would mean a second
-- pipeline, and the whole point of this work is to stop having two of everything.

alter table public.beta_feedback
  alter column organization_id drop not null,
  alter column user_id drop not null;

-- How to reach them, and how to find their account. Required only when there is no user_id: a
-- signed-in operator is never asked for either, because we already know both.
alter table public.beta_feedback
  add column if not exists email text,
  add column if not exists business_name text;

-- The database enforces the same rule the server action does. An anonymous row with no way to
-- reply to it is worse than no row: it looks like a handled request and cannot be answered.
alter table public.beta_feedback
  add constraint beta_feedback_reachable
    check (
      user_id is not null
      or (email is not null and length(btrim(email)) > 0
          and business_name is not null and length(btrim(business_name)) > 0)
    ) not valid;

-- Existing rows all have a user_id, so validation is immediate and cannot fail.
alter table public.beta_feedback validate constraint beta_feedback_reachable;

-- The abuse backstop. lib/http/rate-limit.ts FAILS OPEN when Upstash is unconfigured, which is the
-- right call for the auth-gated endpoints it was written for and the wrong one for a public write
-- that sends mail. This index makes a "how many recent rows from this email" check cheap enough to
-- run on every anonymous submit, so there is a second line that needs no Redis.
create index if not exists beta_feedback_email_created_idx
  on public.beta_feedback (email, created_at desc)
  where email is not null;

comment on column public.beta_feedback.email is
  'ALT-695: reply-to address for a request submitted with NO session. Null for signed-in rows, where profiles.email is authoritative. Enforced by beta_feedback_reachable.';

comment on column public.beta_feedback.business_name is
  'ALT-695: what the person typed as their restaurant name when not signed in. Free text on purpose: it is a lookup hint for a human, never joined on. Null for signed-in rows.';
