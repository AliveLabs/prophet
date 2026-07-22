-- ALT-379: Supabase security-advisor hardening (prophet prod). The CRITICAL (RLS on the two
-- ops_brief_backup tables) was fixed 2026-07-21; this clears the safe, high-confidence WARN
-- findings. All changes are behavior-preserving for the app: the worker + marketing pipeline
-- run as service_role, which we keep; only anon/authenticated exposure is removed.
--
-- Deliberately NOT touched here (need care / a decision, tracked on the ticket): revoking
-- EXECUTE on public.is_org_member / is_org_admin (they're called inside RLS policies, so a
-- blind revoke would break auth); tightening the public storage buckets' listing policies
-- (verify no app .list() first); moving the citext extension out of public; enabling
-- leaked-password protection (Auth dashboard toggle); dropping the backup tables (destructive).

-- ── 0028/0029: SECURITY DEFINER functions callable via /rest/v1/rpc by anon/authenticated ──
-- claim_signal_jobs mutates the job queue; the cron worker calls it as service_role
-- (app/api/cron/worker/route.ts). Lock it to service_role.
revoke execute on function public.claim_signal_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_signal_jobs(integer) to service_role;

-- marketing pipeline helpers — no app caller; service_role only.
revoke execute on function marketing.filter_new_mentions(text[]) from public, anon, authenticated;
grant execute on function marketing.filter_new_mentions(text[]) to service_role;

revoke execute on function marketing.notify_access_granted() from public, anon, authenticated;
grant execute on function marketing.notify_access_granted() to service_role;

-- ── 0011: function_search_path_mutable — pin an immutable search_path. Values match each
-- function's current resolution schemas (claim_signal_jobs -> public.signal_jobs;
-- filter_new_mentions already schema-qualifies marketing.mentions), so behavior is unchanged. ──
alter function public.update_waitlist_updated_at() set search_path = public, pg_catalog;
alter function public.claim_signal_jobs(integer) set search_path = public, pg_catalog;
alter function marketing.filter_new_mentions(text[]) set search_path = marketing, public, pg_catalog;
alter function marketing.set_updated_at() set search_path = marketing, public, pg_catalog;
alter function marketing.set_trial_end_date() set search_path = marketing, public, pg_catalog;
alter function marketing.log_contact_status_change() set search_path = marketing, public, pg_catalog;
alter function marketing.notify_access_granted() set search_path = marketing, public, pg_catalog;

-- ── 0024: rls_policy_always_true on waitlist_signups. Its lone policy ("Service role full
-- access", ALL, USING/CHECK true) was scoped to `public`, so anon + authenticated actually had
-- unrestricted access. The anon waitlist path was retired (marketing sites self-host anti-spam),
-- and service_role bypasses RLS — so dropping the policy keeps service-role writes while
-- denying anon/authenticated. ──
drop policy if exists "Service role full access" on public.waitlist_signups;
