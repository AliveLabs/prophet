-- ALT-225 — operator-set DISPLAY LABEL for a watched competitor (display-only).
--
-- A competitor's `name` is the canonical Google Places / DataForSEO name and is used for
-- matching + de-dup (e.g. the self-exclusion check in competitors/actions.ts and the
-- discover→approve flow). We must NEVER overwrite it, or we'd break the link to the data
-- source. Instead, the operator can set an optional friendly `display_label` (e.g.
-- "Brahm's — Edmond" to tell two same-named locations apart) that the UI shows INSTEAD of
-- `name` wherever a competitor is presented. The raw `name` stays intact for all logic.
--
-- Additive + nullable ⇒ FAIL-SOFT: existing rows unaffected; display resolves to
-- `display_label ?? name`. RLS is inherited from the existing competitors policies
-- (org members can update their own location's competitor rows).

alter table competitors add column if not exists display_label text;

comment on column competitors.display_label is
  'Optional operator-set display name shown in the UI INSTEAD of `name` (ALT-225). Display-only — never used for matching/de-dup, so it cannot break the Google Places link. NULL = show the canonical `name`.';
