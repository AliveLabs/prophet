-- Add feedback columns to insights table
ALTER TABLE insights
  ADD COLUMN IF NOT EXISTS user_feedback text CHECK (user_feedback IN ('useful', 'not_useful')),
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Org-level insight preference weights (learning loop)
CREATE TABLE IF NOT EXISTS insight_preferences (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  insight_type text NOT NULL,
  weight numeric NOT NULL DEFAULT 1.0,
  useful_count int NOT NULL DEFAULT 0,
  dismissed_count int NOT NULL DEFAULT 0,
  last_feedback_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, insight_type)
);

-- RLS for insight_preferences
ALTER TABLE insight_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read own org preferences"
  ON insight_preferences FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Members can upsert own org preferences"
  ON insight_preferences FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Members can update own org preferences"
  ON insight_preferences FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
