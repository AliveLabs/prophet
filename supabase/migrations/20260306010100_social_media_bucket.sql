-- ---------------------------------------------------------------------------
-- Create Supabase Storage bucket for social media post images
-- Downloaded immediately after Data365 collection to avoid CDN URL expiration
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('social-media', 'social-media', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Public read access for social media images
CREATE POLICY "public read social media" ON storage.objects
  FOR SELECT USING (bucket_id = 'social-media');

-- Allow inserts into social-media bucket (service role)
CREATE POLICY "service role insert social media" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'social-media');

-- Allow updates (for upsert) into social-media bucket (service role)
CREATE POLICY "service role update social media" ON storage.objects
  FOR UPDATE USING (bucket_id = 'social-media') WITH CHECK (bucket_id = 'social-media');
