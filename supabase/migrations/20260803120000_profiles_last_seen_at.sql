-- profiles.last_seen_at — when the user was actually USING the product.
--
-- The admin panel showed "Last login", read from auth.users.last_sign_in_at. That is an
-- AUTHENTICATION timestamp, and with passwordless magic links it moves only when a session
-- has to be re-established, so a daily user could read as weeks idle. It answered
-- "when did they last authenticate", never "are they using this".
--
-- Written by a throttled touch on the authenticated request path (lib/auth/presence.ts),
-- not by an auth event. auth.users.last_sign_in_at stays exactly as it was and is still the
-- right source for "has this person EVER signed in" (the team roster's Invited vs Active).

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'Last time the user was active in the app (throttled write from the authed request path). NOT an auth event — see auth.users.last_sign_in_at for authentication.';

-- Sort/filter support for the admin roster and the active-in-last-7-days metric.
create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc nulls last);

-- Seed from the best prior signal so the column is useful on day one rather than reading
-- "Never" for every existing user. One-time; the touch path owns it from here.
update public.profiles p
   set last_seen_at = u.last_sign_in_at
  from auth.users u
 where u.id = p.id
   and p.last_seen_at is null
   and u.last_sign_in_at is not null;
