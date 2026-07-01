-- ALT-227: billing email changes require verification before taking effect.
-- The new email is held pending until the link in a sent verification email is
-- clicked; `billing_email` itself is never written until then. Token is stored
-- hashed (sha256), never in the clear.

alter table organizations
  add column if not exists pending_billing_email text,
  add column if not exists billing_email_token_hash text,
  add column if not exists billing_email_token_expires_at timestamptz,
  add column if not exists billing_email_token_sent_at timestamptz;
