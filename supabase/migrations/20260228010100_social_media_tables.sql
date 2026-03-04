-- Social media profile tracking (links locations/competitors to their social handles)
CREATE TABLE IF NOT EXISTS social_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('location', 'competitor')),
  entity_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok')),
  handle text NOT NULL,
  profile_url text,
  discovery_method text NOT NULL DEFAULT 'manual' CHECK (discovery_method IN ('auto_scrape', 'data365_search', 'manual')),
  is_verified boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_social_profiles_entity ON social_profiles(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_social_profiles_platform ON social_profiles(platform);

-- Social media snapshots (periodic profile + post data)
CREATE TABLE IF NOT EXISTS social_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  date_key date NOT NULL,
  raw_data jsonb NOT NULL,
  diff_hash text NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (social_profile_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_social_snapshots_profile_date ON social_snapshots(social_profile_id, date_key);

-- RLS
ALTER TABLE social_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_snapshots ENABLE ROW LEVEL SECURITY;

-- social_profiles: members can read profiles linked to their org's locations/competitors
CREATE POLICY "org members can read social profiles"
  ON social_profiles FOR SELECT
  USING (
    (entity_type = 'location' AND entity_id IN (
      SELECT l.id FROM locations l
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid()
    ))
    OR
    (entity_type = 'competitor' AND entity_id IN (
      SELECT c.id FROM competitors c
      JOIN locations l ON l.id = c.location_id
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid()
    ))
  );

CREATE POLICY "org admins can insert social profiles"
  ON social_profiles FOR INSERT
  WITH CHECK (
    (entity_type = 'location' AND entity_id IN (
      SELECT l.id FROM locations l
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    ))
    OR
    (entity_type = 'competitor' AND entity_id IN (
      SELECT c.id FROM competitors c
      JOIN locations l ON l.id = c.location_id
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    ))
  );

CREATE POLICY "org admins can update social profiles"
  ON social_profiles FOR UPDATE
  USING (
    (entity_type = 'location' AND entity_id IN (
      SELECT l.id FROM locations l
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    ))
    OR
    (entity_type = 'competitor' AND entity_id IN (
      SELECT c.id FROM competitors c
      JOIN locations l ON l.id = c.location_id
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    ))
  );

CREATE POLICY "org admins can delete social profiles"
  ON social_profiles FOR DELETE
  USING (
    (entity_type = 'location' AND entity_id IN (
      SELECT l.id FROM locations l
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    ))
    OR
    (entity_type = 'competitor' AND entity_id IN (
      SELECT c.id FROM competitors c
      JOIN locations l ON l.id = c.location_id
      JOIN organization_members m ON m.organization_id = l.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    ))
  );

-- social_snapshots: members can read snapshots for their org's social profiles
CREATE POLICY "org members can read social snapshots"
  ON social_snapshots FOR SELECT
  USING (
    social_profile_id IN (
      SELECT sp.id FROM social_profiles sp
      WHERE
        (sp.entity_type = 'location' AND sp.entity_id IN (
          SELECT l.id FROM locations l
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid()
        ))
        OR
        (sp.entity_type = 'competitor' AND sp.entity_id IN (
          SELECT c.id FROM competitors c
          JOIN locations l ON l.id = c.location_id
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "org admins can insert social snapshots"
  ON social_snapshots FOR INSERT
  WITH CHECK (
    social_profile_id IN (
      SELECT sp.id FROM social_profiles sp
      WHERE
        (sp.entity_type = 'location' AND sp.entity_id IN (
          SELECT l.id FROM locations l
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
        ))
        OR
        (sp.entity_type = 'competitor' AND sp.entity_id IN (
          SELECT c.id FROM competitors c
          JOIN locations l ON l.id = c.location_id
          JOIN organization_members m ON m.organization_id = l.organization_id
          WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
        ))
    )
  );
