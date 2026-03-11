-- Expand insights.status to support actionable workflow states
ALTER TABLE insights DROP CONSTRAINT IF EXISTS insights_status_check;
ALTER TABLE insights ADD CONSTRAINT insights_status_check
  CHECK (status IN ('new', 'read', 'todo', 'actioned', 'snoozed', 'dismissed'));
