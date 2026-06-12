-- "Report as inaccurate" (insights & onboarding review, 2026-06-11): a
-- data-correctness signal distinct from "dismissed" (= accurate but not
-- useful). Reported insights are hidden from the feed and feed the same
-- not_useful preference down-weighting; the status makes bad source data
-- queryable for ops follow-up.
ALTER TABLE insights DROP CONSTRAINT IF EXISTS insights_status_check;
ALTER TABLE insights ADD CONSTRAINT insights_status_check
  CHECK (status IN ('new', 'read', 'todo', 'actioned', 'snoozed', 'dismissed', 'inaccurate'));
