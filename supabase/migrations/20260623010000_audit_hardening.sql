-- Audit hardening (admin-rebuild Phase 6b).
-- Makes admin_activity_log tamper-proof append-only and adds a reason + actor type.

alter table public.admin_activity_log
  add column if not exists reason text;

alter table public.admin_activity_log
  add column if not exists actor_type text not null default 'admin';

alter table public.admin_activity_log
  drop constraint if exists admin_activity_log_actor_type_check;
alter table public.admin_activity_log
  add constraint admin_activity_log_actor_type_check
  check (actor_type in ('admin', 'system'));

-- APPEND-ONLY / TAMPER-PROOF: nobody — not even the service role the app runs as — may
-- UPDATE or DELETE an audit row. The app only ever INSERTs + SELECTs the log, so this is
-- zero behavioral impact; it just makes history un-rewritable. (RLS already blocks anon /
-- authenticated entirely via the existing "No public access" USING(false) policy; this adds
-- the privilege-level guarantee against the service role.)
revoke update, delete on public.admin_activity_log from anon, authenticated, service_role;

-- NOTE (deferred, intentional): a stricter "inserts ONLY via a SECURITY DEFINER function"
-- layer was considered. It's omitted here because revoking INSERT from service_role on an
-- un-stageable prod DB, combined with the new "no log => no action" rule, risks blocking all
-- destructive admin actions if the function/grants are subtly wrong. service_role is the sole
-- trusted writer, so REVOKE UPDATE/DELETE already delivers the tamper-proofing that matters.

comment on column public.admin_activity_log.reason is
  'Operator-supplied justification; required by the app on destructive actions (Phase 6b).';
comment on column public.admin_activity_log.actor_type is
  'admin = a platform admin via the panel; system = an automated writer (e.g. the Stripe webhook).';
