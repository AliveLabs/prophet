-- Enable RLS on the 6 marketing-schema tables flagged by the Supabase
-- advisor as `rls_disabled_in_public` (security email of 2026-05-25).
-- Service_role traffic (Next.js admin client + n8n Stream 2 webhooks)
-- is unaffected because service_role has BYPASSRLS = true. The anon key
-- is the audience being cut off, which is the whole point.

ALTER TABLE marketing.mentions                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.outbound_queue                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.prospects                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.replies_processed                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.studio_outbound_pending_approval  ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.shared_domain_daily_counter       ENABLE ROW LEVEL SECURITY;

-- Match the existing belt-and-suspenders pattern from
-- 20260424152231_marketing_stream1_schema.sql lines 307-315
-- (contacts/email_log/events/failed_events). With RLS on and no
-- permissive policies, anon is already denied; these explicit deny
-- policies make the intent self-documenting and resilient against
-- a future hand that accidentally adds a permissive policy.

DROP POLICY IF EXISTS mentions_anon_deny                         ON marketing.mentions;
DROP POLICY IF EXISTS outbound_queue_anon_deny                   ON marketing.outbound_queue;
DROP POLICY IF EXISTS prospects_anon_deny                        ON marketing.prospects;
DROP POLICY IF EXISTS replies_processed_anon_deny                ON marketing.replies_processed;
DROP POLICY IF EXISTS studio_outbound_pending_approval_anon_deny ON marketing.studio_outbound_pending_approval;
DROP POLICY IF EXISTS shared_domain_daily_counter_anon_deny      ON marketing.shared_domain_daily_counter;

CREATE POLICY mentions_anon_deny                         ON marketing.mentions                         FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY outbound_queue_anon_deny                   ON marketing.outbound_queue                   FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY prospects_anon_deny                        ON marketing.prospects                        FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY replies_processed_anon_deny                ON marketing.replies_processed                FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY studio_outbound_pending_approval_anon_deny ON marketing.studio_outbound_pending_approval FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY shared_domain_daily_counter_anon_deny      ON marketing.shared_domain_daily_counter      FOR ALL TO anon USING (false) WITH CHECK (false);

-- Defense-in-depth: revoke the loose anon/authenticated INSERT/UPDATE
-- grants that exist only on marketing.mentions. RLS already blocks
-- these post-fix, but dropping the grants too means a misconfigured
-- future policy can't accidentally re-open them.
REVOKE INSERT, UPDATE ON marketing.mentions FROM anon, authenticated;
