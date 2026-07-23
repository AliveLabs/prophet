-- ALT-379 follow-up (security advisor 0025 — public_bucket_allows_listing).
-- The competitor-photos / meta-ads-creatives / social-media buckets are PUBLIC and each had a
-- broad SELECT policy on storage.objects (roles = public, bucket_id = '<bucket>'), which lets ANY
-- client enumerate every filename in the bucket via the storage list API. The app never lists
-- these buckets — verified: no .list() calls anywhere; every read goes through getPublicUrl (or
-- createSignedUrl for the content bucket). Public buckets serve objects over the public URL path
-- REGARDLESS of storage.objects RLS, so dropping these SELECT policies removes anonymous
-- enumeration WITHOUT affecting image display.
--
-- Rollback (only if some image access regresses): recreate each policy, e.g.
--   create policy "public read competitor photos" on storage.objects
--     for select to public using (bucket_id = 'competitor-photos');
--   create policy "public read meta ads creatives" on storage.objects
--     for select to public using (bucket_id = 'meta-ads-creatives');
--   create policy "public read social media" on storage.objects
--     for select to public using (bucket_id = 'social-media');

drop policy if exists "public read competitor photos" on storage.objects;
drop policy if exists "public read meta ads creatives" on storage.objects;
drop policy if exists "public read social media" on storage.objects;
