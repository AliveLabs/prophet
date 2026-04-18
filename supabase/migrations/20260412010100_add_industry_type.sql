-- Phase 1A: Add industry_type column to organizations
-- Safe: DEFAULT 'restaurant' ensures all existing insert paths continue working

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS industry_type text DEFAULT 'restaurant';

UPDATE organizations SET industry_type = 'restaurant' WHERE industry_type IS NULL;

ALTER TABLE organizations ALTER COLUMN industry_type SET NOT NULL;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_industry_type_check
  CHECK (industry_type IN ('restaurant', 'liquor_store'));

CREATE INDEX IF NOT EXISTS idx_organizations_industry_type
  ON organizations(industry_type);
