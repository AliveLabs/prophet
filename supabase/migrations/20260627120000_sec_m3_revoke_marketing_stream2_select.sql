-- SEC-M3 — revoke the latent SELECT grants on the marketing Stream-2 objects.
--
-- These hold Alive Labs' OWN outbound / CRM data (NOT customer-tenant data). They have RLS enabled
-- with an anon_deny policy and NO permissive `authenticated` policy, so ordinary logged-in users
-- cannot read them today. But each still carries a `GRANT SELECT ... TO anon, authenticated` from
-- the original schema migration (20260525192924_stream2_outbound_schema.sql). That grant is a
-- footgun: the day someone adds a permissive `authenticated` policy to "fix functionality", every
-- logged-in customer could read this data. Removing the grant means a future permissive policy
-- can't silently expose it. service_role keeps its access (it bypasses both grants and RLS).
--
-- Verified against prod 2026-06-27: SELECT is granted to anon + authenticated on exactly these 7
-- objects (6 tables + 1 view). Idempotent — REVOKE of an absent grant is a no-op.

REVOKE SELECT ON
    marketing.mentions,
    marketing.outbound_queue,
    marketing.prospects,
    marketing.replies_processed,
    marketing.studio_outbound_pending_approval,
    marketing.shared_domain_daily_counter,
    marketing.v_outbound_queue_depth
  FROM anon, authenticated;

-- Invariant assertion (the SEC-M3 "test"): fail this migration if any PERMISSIVE policy that targets
-- `authenticated` or `public` for read exists on a marketing.* table — the exact condition that,
-- combined with a lingering SELECT grant, would expose this data. Deny policies (USING (false)) and
-- anon-only policies are correctly ignored. Keeps the schema honest going forward.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(format('%I.%I (%I)', schemaname, tablename, policyname), ', ')
    INTO offending
  FROM pg_policies
  WHERE schemaname = 'marketing'
    AND ('authenticated' = ANY (roles) OR 'public' = ANY (roles))
    AND cmd IN ('SELECT', 'ALL')
    AND COALESCE(qual, 'true') <> 'false';

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'SEC-M3: permissive authenticated/public read policy on marketing.* would expose CRM data -> %',
      offending;
  END IF;
END $$;
