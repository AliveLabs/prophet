-- ALT-453 replay repair: waitlist_signups was created out-of-band on prod and never
-- captured as a migration, so a clean linear replay failed here ("relation
-- waitlist_signups does not exist"). Recreate its pre-Step-1 shape so the steps below
-- transform it to the current state. No-op on prod (table already exists); this
-- migration never re-runs there. Columns/constraints mirror prod introspection.
CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  business_name text,
  city text,
  source text NOT NULL DEFAULT 'landing_page',
  referred_by text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'invited', 'converted', 'unsubscribed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  first_name text,
  last_name text
);
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

-- Step 1: Drop existing CHECK constraint first (it only allows pending/invited/converted/unsubscribed)
ALTER TABLE public.waitlist_signups
  DROP CONSTRAINT IF EXISTS waitlist_signups_status_check;

-- Step 2: Migrate existing 'invited' rows to 'approved'
UPDATE public.waitlist_signups SET status = 'approved' WHERE status = 'invited';
UPDATE public.waitlist_signups SET status = 'approved' WHERE status = 'converted';

-- Step 3: Add new CHECK constraint with valid statuses
ALTER TABLE public.waitlist_signups
  ADD CONSTRAINT waitlist_signups_status_check
  CHECK (status IN ('pending', 'approved', 'declined'));

-- Step 4: Add admin review columns to waitlist_signups
ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Step 5: Add indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_waitlist_signups_status ON public.waitlist_signups(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_signups_created ON public.waitlist_signups(created_at DESC);

-- Step 6: Create platform_admins table
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id),
  UNIQUE(email)
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'platform_admins' AND policyname = 'No public access') THEN
    CREATE POLICY "No public access" ON public.platform_admins FOR ALL USING (false);
  END IF;
END $$;

-- Step 7: Add waitlist_signup_id to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS waitlist_signup_id UUID REFERENCES public.waitlist_signups(id);

-- Step 8: Seed initial platform admin (anand@alivemethod.com)
INSERT INTO public.platform_admins (user_id, email)
VALUES ('7014cc05-b8b1-4a94-bf06-2e7de472837f', 'anand@alivemethod.com')
ON CONFLICT (email) DO NOTHING;

-- Step 9: Updated_at trigger for waitlist_signups (if not exists)
CREATE OR REPLACE FUNCTION public.update_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'waitlist_updated_at') THEN
    CREATE TRIGGER waitlist_updated_at
      BEFORE UPDATE ON public.waitlist_signups
      FOR EACH ROW EXECUTE FUNCTION public.update_waitlist_updated_at();
  END IF;
END $$;
