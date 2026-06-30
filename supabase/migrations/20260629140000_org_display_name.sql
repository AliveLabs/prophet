-- ALT-226 — separate the immutable/legal organization name from an editable Display name.
--
-- `organizations.name` is the legal/account name (e.g. "Raising Cane's Restaurants, LLC")
-- shown read-only at the top of org settings. `display_name` is an optional, editable
-- friendlier label (e.g. "Raising Cane's") shown wherever we present the org to the
-- operator. Display resolves to `display_name ?? name`, so existing orgs read unchanged
-- until someone sets one.
--
-- Additive + nullable ⇒ FAIL-SOFT. RLS inherited from the existing organizations policies
-- (owner/admin can update their org).

alter table organizations add column if not exists display_name text;

comment on column organizations.display_name is
  'Optional editable display name for the org, shown in the UI INSTEAD of the legal `name` (ALT-226). NULL = show `name`. The legal `name` stays immutable in the settings UI.';
