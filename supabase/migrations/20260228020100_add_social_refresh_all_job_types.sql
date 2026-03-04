-- Expand refresh_jobs job_type constraint to include social and refresh_all
ALTER TABLE refresh_jobs DROP CONSTRAINT IF EXISTS refresh_jobs_job_type_check;
ALTER TABLE refresh_jobs ADD CONSTRAINT refresh_jobs_job_type_check
  CHECK (job_type IN ('content','visibility','events','insights','photos','busy_times','weather','social','refresh_all'));
