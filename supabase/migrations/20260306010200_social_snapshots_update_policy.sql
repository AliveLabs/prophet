-- ---------------------------------------------------------------------------
-- Add UPDATE policy for social_snapshots
-- Without this, upserts that hit existing rows are silently rejected by RLS,
-- preventing the pipeline from updating snapshot data (e.g., replacing
-- expired CDN image URLs with permanent Supabase Storage URLs).
-- ---------------------------------------------------------------------------

CREATE POLICY "org admins can update social snapshots" ON social_snapshots
  FOR UPDATE
  USING (
    social_profile_id IN (
      SELECT sp.id FROM social_profiles sp
      WHERE (
        (sp.entity_type = 'location' AND sp.entity_id IN (
          SELECT l.id FROM locations l
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid() AND m.role IN ('owner','admin')
        ))
        OR
        (sp.entity_type = 'competitor' AND sp.entity_id IN (
          SELECT c.id FROM competitors c
          JOIN locations l ON l.id = c.location_id
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid() AND m.role IN ('owner','admin')
        ))
      )
    )
  )
  WITH CHECK (
    social_profile_id IN (
      SELECT sp.id FROM social_profiles sp
      WHERE (
        (sp.entity_type = 'location' AND sp.entity_id IN (
          SELECT l.id FROM locations l
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid() AND m.role IN ('owner','admin')
        ))
        OR
        (sp.entity_type = 'competitor' AND sp.entity_id IN (
          SELECT c.id FROM competitors c
          JOIN locations l ON l.id = c.location_id
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid() AND m.role IN ('owner','admin')
        ))
      )
    )
  );
