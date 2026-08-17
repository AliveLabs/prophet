-- beta_feedback -> Notion sync bookkeeping.
--
-- The form has always written the row and then best-effort emailed ops. Both halves of
-- "best effort" bit on 2026-08-17: seven walkthrough entries saved correctly, ONE email
-- arrived, and no Notion ticket was ever created because that integration did not exist.
--
-- The lesson is that a fire-and-forget notification is not a delivery guarantee. These
-- columns make the sync RESUMABLE instead: a row with notion_page_id IS NULL has not been
-- ticketed yet, so a cron can sweep and finish the job no matter how the inline attempt
-- failed. That also makes the inline call safe to lose.
--
-- All three are nullable and nothing backfills them: rows predating this migration were
-- ticketed by hand, and leaving them NULL would make the sweeper re-file duplicates. The
-- backfill below stamps them as handled instead.

alter table public.beta_feedback
  add column if not exists notion_page_id text null,
  add column if not exists notion_synced_at timestamptz null,
  add column if not exists notion_error text null;

comment on column public.beta_feedback.notion_page_id is
  'Notion page id for this feedback''s ticket. NULL means NOT YET TICKETED and the sweeper will pick it up.';
comment on column public.beta_feedback.notion_synced_at is
  'When the ticket was created. NULL with a non-null notion_page_id should never happen.';
comment on column public.beta_feedback.notion_error is
  'Last sync failure, kept so a repeatedly failing row is visible rather than silently retried forever.';

-- The sweeper''s only query: unticketed rows, oldest first. Partial index so it stays
-- small as the table grows -- once a row is ticketed it leaves the index for good.
create index if not exists beta_feedback_unticketed_idx
  on public.beta_feedback (created_at)
  where notion_page_id is null;
