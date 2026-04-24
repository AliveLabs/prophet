-- Follow-up to 20260421225248_marketing_schema_and_role.
-- The original migration granted USAGE on the marketing schema to
-- marketing_ops only. The product backend writes into marketing.contacts via
-- the service_role key, so it also needs USAGE on the schema. Without this,
-- the Stripe webhook / waitlist / posthog-bridge mirror calls fail with
-- `permission denied for schema marketing` the moment
-- MARKETING_CONTACTS_ENABLED is flipped on.
--
-- Chris's stream1 table DDL grants ALL on the specific tables to service_role
-- on its own, so this just covers the schema-level USAGE prerequisite.

grant usage on schema marketing to service_role;
