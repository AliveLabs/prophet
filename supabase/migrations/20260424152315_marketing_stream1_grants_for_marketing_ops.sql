-- Chris's stream1 schema file grants only to service_role. Our role-setup
-- migration (20260421225248) defined `marketing_ops` for n8n to use, but
-- without these grants n8n would hit permission_denied on every read/write.
-- The ALTER DEFAULT PRIVILEGES only applies to objects created BY
-- marketing_ops; Chris's tables were created by postgres.

grant select, insert, update, delete on marketing.contacts       to marketing_ops;
grant select, insert, update, delete on marketing.email_log      to marketing_ops;
grant select, insert, update, delete on marketing.events         to marketing_ops;
grant select, insert, update, delete on marketing.failed_events  to marketing_ops;

grant select on marketing.v_waitlist_nurture_due  to marketing_ops;
grant select on marketing.v_trial_onboarding_due  to marketing_ops;
grant select on marketing.v_auric_crosssell_due   to marketing_ops;

-- sequences from gen_random_uuid() defaults don't need explicit grants, but
-- in case Chris adds a serial/identity column later, mirror the existing
-- service_role grant pattern.
grant usage, select on all sequences in schema marketing to marketing_ops;

-- Functions (for the triggers) don't need grants for trigger execution
-- because triggers run as the table owner (postgres). No grants here.
