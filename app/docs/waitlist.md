# VATIC - Waitlist, Admin & Pre-Launch Operations PRD

> **Date:** March 31, 2026
> **Status:** Implementation-ready
> **Source:** Alive Labs meeting, March 30, 2026
> **Stack:** Next.js 16+ / Supabase / Resend / Shadcn UI

---

## Critical Context

The current waitlist flow is broken. Right now, anyone who fills out the waitlist form on the homepage gets a Supabase auth account created immediately and receives a magic link that grants direct dashboard access.

**The client explicitly does NOT want this.** The dashboard is incomplete. There must be an admin approval gate between signup and access.

### What needs to happen:
1. Waitlist signups go into a `waitlist_signups` table with status `pending` - NO auth user created
2. An admin page at `/admin/waitlist` lets Chris/Bryan approve or decline signups
3. On approval: create the auth user, create the org with trial dates, send invitation email with magic link
4. On decline: update status, send polite decline email, no auth user created
5. Trial clock (14 days) starts on approval, NOT on signup

---

## Phase 1: Database & Server Actions

### 1.1 Create `waitlist_signups` table

```sql
-- Migration: create waitlist_signups table
CREATE TABLE public.waitlist_signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  source TEXT,
  admin_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint on email
CREATE UNIQUE INDEX idx_waitlist_signups_email ON public.waitlist_signups(email);

-- Index for admin queries
CREATE INDEX idx_waitlist_signups_status ON public.waitlist_signups(status);
CREATE INDEX idx_waitlist_signups_created ON public.waitlist_signups(created_at DESC);

-- RLS
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

-- Public can insert (waitlist form is public)
CREATE POLICY "Anyone can submit to waitlist"
  ON public.waitlist_signups FOR INSERT
  WITH CHECK (true);

-- Only admins can read
CREATE POLICY "Admins can read waitlist"
  ON public.waitlist_signups FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- Only admins can update, and only valid transitions
CREATE POLICY "Admins can update waitlist status"
  ON public.waitlist_signups FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- No deletes - audit trail
CREATE POLICY "No deletes on waitlist"
  ON public.waitlist_signups FOR DELETE
  USING (false);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER waitlist_updated_at
  BEFORE UPDATE ON public.waitlist_signups
  FOR EACH ROW EXECUTE FUNCTION update_waitlist_updated_at();
```

### 1.2 Add trial columns to organizations table

```sql
-- Migration: add trial tracking to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waitlist_signup_id UUID REFERENCES public.waitlist_signups(id);
```

### 1.3 Named constant

In `lib/constants.ts`:
```typescript
export const TRIAL_DURATION_DAYS = 14;
```

Never hardcode `14` anywhere. Always reference `TRIAL_DURATION_DAYS`.

### 1.4 Server Actions

Create `app/actions/waitlist.ts`:

**submitWaitlistSignup** (public, no auth required)
- Validate email format
- Check if email already exists in waitlist_signups
- If exists: return `{ success: false, message: "This email is already on our waitlist." }`
- Insert into waitlist_signups with status='pending'
- Send Waitlist Confirmation email via Resend
- If Resend fails: log error, do NOT block the insert
- Return `{ success: true }`

**approveWaitlistSignup** (admin only)
- Verify admin auth via Supabase service role
- Fetch signup record, confirm status='pending'
- Create Supabase auth user: `supabase.auth.admin.createUser({ email, email_confirm: true })`
- Create organization record:
  - `trial_started_at = new Date()`
  - `trial_expires_at = addDays(new Date(), TRIAL_DURATION_DAYS)`
  - `waitlist_signup_id = signup.id`
- Update waitlist_signups: status='approved', reviewed_by, reviewed_at
- Generate magic link: `supabase.auth.admin.generateLink({ type: 'magiclink', email })`
- Send Invitation Email via Resend with the magic link URL
- If auth user already exists (edge case): skip createUser, still create org and send email

**declineWaitlistSignup** (admin only)
- Verify admin auth
- Fetch signup record, confirm status='pending'
- Update waitlist_signups: status='declined', reviewed_by, reviewed_at, admin_notes
- Send Decline Email via Resend
- If Resend fails: log error, still update status

### Phase 1 Verification Checklist
- [ ] `SELECT * FROM waitlist_signups;` returns correct schema after migration
- [ ] Anonymous user can insert into waitlist_signups
- [ ] Non-admin authenticated user CANNOT read waitlist_signups
- [ ] Admin user CAN read and update waitlist_signups
- [ ] Status transitions work: pending -> approved, pending -> declined
- [ ] No rows can be deleted from waitlist_signups

---

## Phase 2: Fix Homepage Waitlist Form

### What to remove
- Remove `supabase.auth.signUp()` call from the waitlist form handler
- Remove magic link generation from the waitlist form handler
- Remove any redirect to dashboard after waitlist signup

### What to replace it with
- Wire the form to `submitWaitlistSignup` server action
- On success: show inline message "You are on the list! Check your email for confirmation."
- On duplicate email: show "This email is already on our waitlist."
- No redirect. No login. User stays on the homepage.

### Phase 2 Verification Checklist
- [ ] Submit the waitlist form with a new email
- [ ] Confirm NO auth user is created in Supabase Auth dashboard
- [ ] Confirm a row appears in waitlist_signups with status='pending'
- [ ] Confirm only the Waitlist Confirmation email is sent (no magic link)
- [ ] Submit the same email again, confirm duplicate message shows
- [ ] Confirm user is NOT redirected anywhere

---

## Phase 3: Transactional Emails

Build three new React Email templates. All use Vatic brand colors (teal #0D9488 + indigo #4F46E5), Cormorant Garamond for headings.

### waitlist-confirmation.tsx
- **Subject:** You are on the Vatic waitlist
- **Trigger:** User submits waitlist form
- **Content:** Thank them. Set expectations ("We are rolling out access in batches and will notify you when your spot is ready."). No login link. No magic link.
- **Tone:** Warm, brief, professional

### waitlist-invitation.tsx
- **Subject:** You are in! Your Vatic dashboard is ready
- **Trigger:** Admin approves signup
- **Content:** Congratulate them. Prominent CTA button with magic link. Mention 14-day trial.
- **CTA button text:** Access Your Dashboard
- **CTA URL:** Magic link from `supabase.auth.admin.generateLink()`

### waitlist-decline.tsx
- **Subject:** Update on your Vatic waitlist request
- **Trigger:** Admin declines signup
- **Content:** Polite. Do NOT say "declined" or "rejected". Say: "We are not able to offer access at this time as we roll out in limited batches. We will keep you posted as availability opens up."
- **Tone:** Respectful, leaves door open

### Phase 3 Verification Checklist
- [ ] Trigger each email by calling the server action directly
- [ ] Check Resend dashboard to confirm all three deliver
- [ ] Verify magic link in invitation email creates a valid session
- [ ] Verify all emails render correctly on mobile (React Email preview)

---

## Phase 4: Admin Dashboard

### 4.1 Route Setup
- Create `/admin` layout with middleware that checks for admin role in user_metadata
- Non-admin users hitting `/admin/*` get redirected to main dashboard
- Admin role is set manually in Supabase for Chris, Bryan, and Anand

### 4.2 /admin/waitlist Page

**Stats summary cards** (top of page):
- Total signups (all time)
- Pending (awaiting review)
- Approved (with active trials)
- Declined

**Data table columns:**
| Column | Sortable | Filterable | Notes |
|--------|----------|------------|-------|
| Email | Yes | Search | Primary identifier |
| Full Name | Yes | Search | From signup form |
| Status | Yes | Dropdown | Color-coded badge (yellow=pending, green=approved, red=declined) |
| Signed Up | Yes (default: newest first) | Date range | Relative time display |
| Reviewed By | No | No | Admin name, shown only for reviewed entries |
| Actions | No | No | Approve / Decline buttons |

**Batch operations:**
- Checkbox selection on each row
- "Select all pending" shortcut
- Batch Approve and Batch Decline in toolbar, both with confirmation dialog
- Batch operations trigger the same server actions as individual ones (including email sends)

### Phase 4 Verification Checklist
- [ ] Log in as admin, navigate to /admin/waitlist, see pending signups
- [ ] Approve a signup: auth user created, org created with trial dates, invitation email sent
- [ ] Decline a signup: no auth user created, decline email sent
- [ ] Batch approve 3 signups: all three get auth users, orgs, and emails
- [ ] Log in as non-admin: /admin/* redirects to dashboard
- [ ] Stats cards show correct counts
- [ ] Filter by status works
- [ ] Search by email/name works

---

## Phase 5: Trial Gating & Polish

- Add trial banner to dashboard showing days remaining (partially built already)
- Trial expiration gate: if `trial_expires_at < now()` AND no active Stripe subscription, show upgrade prompt instead of dashboard content
- Modify existing cron jobs to skip processing for expired trial orgs
- Add dark mode toggle to homepage and authenticated layout (currently only on sign-in page)
- Detect system preference on first load via `prefers-color-scheme`
- Run security audit: create two test accounts, verify complete data isolation

### Phase 5 Verification Checklist
- [ ] Manually set trial_expires_at to past date, confirm upgrade gate shows
- [ ] Reset trial, confirm dashboard content accessible
- [ ] Verify cron logs show skipped expired trial orgs
- [ ] Dark mode toggle works on homepage, dashboard, and all pages
- [ ] Two test accounts show zero data leakage between orgs

---

## New & Modified Files

| File Path | Action | Description |
|-----------|--------|-------------|
| `lib/constants.ts` | Modify | Add TRIAL_DURATION_DAYS = 14 |
| `supabase/migrations/XXXXXX_waitlist_signups.sql` | Create | New table + RLS policies |
| `supabase/migrations/XXXXXX_org_trial_columns.sql` | Create | Trial columns on organizations |
| `app/actions/waitlist.ts` | Create | Server actions: submit, approve, decline |
| `app/(marketing)/page.tsx` | Modify | Rewire waitlist form, remove auth.signUp |
| `app/(marketing)/components/waitlist-form.tsx` | Modify | Client component for form + success state |
| `app/admin/layout.tsx` | Create | Admin layout with role middleware |
| `app/admin/waitlist/page.tsx` | Create | Admin waitlist management page |
| `app/admin/waitlist/components/waitlist-table.tsx` | Create | Data table with filters and batch ops |
| `app/admin/waitlist/components/stats-cards.tsx` | Create | Summary stat cards |
| `emails/waitlist-confirmation.tsx` | Create | React Email template |
| `emails/waitlist-invitation.tsx` | Create | React Email template with magic link |
| `emails/waitlist-decline.tsx` | Create | React Email template |
| `middleware.ts` | Modify | Add admin route protection |

---

## Open Decisions (Need input from Bryan/Chris)

1. **Should declined users be able to reapply?** Suggested default: No. Admin can manually re-approve.
2. **Should admins get notified of new signups?** Suggested: Yes, daily digest email. Low priority.
3. **What is the from address?** noreply@vatic.app or hello@vatic.app. Chris to confirm with Resend setup.
4. **Should admin page also show active trials?** Suggested: Yes, as a second tab /admin/trials. Build after waitlist ships.
5. **Bryan's UX fork workflow:** Bryan forks, makes changes, uses Claude to produce change list. Anand reviews and merges. 30-min call scheduled to walk through fork setup.