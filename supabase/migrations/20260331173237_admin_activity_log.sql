CREATE TABLE public.admin_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID NOT NULL,
  admin_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_activity_log_created ON public.admin_activity_log(created_at DESC);
CREATE INDEX idx_activity_log_target ON public.admin_activity_log(target_type, target_id);
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access" ON public.admin_activity_log FOR ALL USING (false);
