# Migrations

This directory intentionally holds **one baseline migration**, not the app's full history.

## Why there's only one file

`20260723000000_baseline_squash_alt453.sql` is a schema-only dump of the production
database (`public` + `marketing`), taken 2026-07-24 and cleaned so it replays onto an empty
Postgres. It replaces the 71 incremental migrations that came before it.

The old files were not cleanly replayable. Production had been built up over months with a
mix of `db push` and out-of-band changes, so a fresh linear replay failed:

- `20260131_visual_intelligence` altered `refresh_jobs` before `20260209_refresh_jobs`
  created it.
- `waitlist_signups` was altered by `20260331_waitlist_admin_setup` but no migration ever
  created it (it was created directly against prod).

The practical symptom: **Supabase branch creation failed** with `MIGRATIONS_FAILED`, which
blocked preview/staging database isolation, and meant production was not reproducible from
source at all. The squash fixes both.

The old files remain in git history (see the commit that added this README) if you ever need
to read them.

## Cleaning applied to the raw dump

A raw `pg_dump --schema-only` does not replay as a migration. These edits were required, and
any regenerated baseline needs them again:

1. Stripped `\restrict` / `\unrestrict` psql meta-commands (pg_dump 18 emits them; the
   migration runner sends raw SQL, not a psql session).
2. `CREATE SCHEMA public` / `marketing` made `IF NOT EXISTS` (a fresh branch already has
   `public`).
3. Prepended a guarded `CREATE ROLE marketing_ops` so the 25 grants that reference it
   resolve (roles live outside a schema-only dump).
4. Added `CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public` — `marketing.contacts.email`
   is `public.citext`, and extensions aren't included in a schema-only dump.
5. Removed all 27 `ALTER DEFAULT PRIVILEGES` statements: the branch's replay role cannot set
   default privileges *for another role* (`permission denied to change default privileges`),
   and they only affect objects created later, so they're irrelevant to a fresh schema.

## Production's migration ledger

Production's `supabase_migrations.schema_migrations` was squashed to match: a single row,
version `20260723000000`, whose `statements[1]` is this same SQL. That is what Supabase
replays when creating a branch — **branches replay the parent project's stored ledger, not
this directory** — so if you regenerate this baseline you must update that row too, or
branches will keep building the old schema.

Verified after the squash: a fresh `staging` branch reached `FUNCTIONS_DEPLOYED` with 47
`public` + 10 `marketing` tables, 117 policies, 57 functions, and no production data.

## Adding migrations from here

Business as usual: add a new timestamped file after the baseline. Only the baseline is
special.
