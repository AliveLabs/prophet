-- ---------------------------------------------------------------------------
-- Create Supabase Storage bucket for website screenshots
-- Used by Content & Menu Intelligence feature
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('screenshots', 'screenshots', false, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;
