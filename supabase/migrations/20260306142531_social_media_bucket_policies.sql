-- Public read access for social media images
CREATE POLICY "public read social media" ON storage.objects
  FOR SELECT USING (bucket_id = 'social-media');

-- Allow inserts into social-media bucket (service role)
CREATE POLICY "service role insert social media" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'social-media');

-- Allow updates (for upsert) into social-media bucket (service role)
CREATE POLICY "service role update social media" ON storage.objects
  FOR UPDATE USING (bucket_id = 'social-media') WITH CHECK (bucket_id = 'social-media');
