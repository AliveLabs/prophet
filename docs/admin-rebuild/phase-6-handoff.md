# Phase 6 Handoff — Security Hardening (TicketAdmin rebuild)

**Written 2026-06-22.** Phases 0–5 are SHIPPED to prod. This doc is the spec for Phase 6, to be done in
a fresh session (Phase 6 is large + security-critical; see effort note at bottom). Build to FINISHED —
no "good enough"/demo-bar scope cuts.

## Current state (start here)
- Repo: `/Users/bryancastles/Documents/Projects/Claude/Alive Labs/Ticket/GetTicket` (AliveLabs/prophet).
- Branch **spine-rewrite**; `main` = **b8a9a2c** (Phases 0–5). Deploys green.
- **Deploy flow:** commit on spine-rewrite → `git push origin spine-rewrite` → `git push origin spine-rewrite:main` (fast-forward) → Vercel auto-deploys main. Confirm via `vercel ls prophet`.
- **Verification gate every change:** `npx tsc --noEmit` + `npm run test:unit` (329 tests) + `npx eslint <files>` + `npm run build`. All must be green before commit.
- **Standing rules:** NO ad-hoc service-role prod writes — admin actions / normal flow only. DDL goes via the Supabase SQL editor (I can't run DDL); hand Bryan the exact SQL, he runs it (he prefers SQL editor over me touching prod). Plan doc: `docs/admin-rebuild/ticket-admin-rebuild-plan.md` (§5 = the security model this implements).
- Memory to read first: `[[ticket-admin-panel-and-demo-data]]`, `[[bryan-finished-tools-not-good-enough]]`.

## Phase 6 scope — 5 sub-phases (suggest one PR/deploy each, with a review between)

### 6a. Roles / capabilities (P0)
- Migration: add `role text not null default 'super_admin'` (or a `capabilities text[]`) to `platform_admins`,
  CHECK in ('super_admin','admin','read_only'). **Backfill existing admins to `super_admin`** (Bryan + Chris).
  Decision (locked): 3 tiers — Super Admin (Bryan+Chris, everything), Admin (day-to-day: view/edit, trial
  extend, magic-link/resend, impersonate, create+clear demo/test, deactivate — NOT hard-delete of Customer
  orgs/users, billing conversion, manage-admins, →Customer reclassify), Read-only (view+export).
- `lib/auth/platform-admin.ts`: add `requireCapability(cap)` returning `{ user, role }`; keep
  `requirePlatformAdmin` as "any admin". Define a capability→role matrix.
- **`withAdminAction(capability, fn)` wrapper** (P0): wrap EVERY admin server action so the gate + audit +
  (later) rate-limit can't be forgotten. Apply across: `app/actions/waitlist.ts`, `user-management.ts`,
  `org-management.ts`, `admin-management.ts`, `admin-maintenance.ts`, `admin-email.ts` (~20 actions).
  CAUTION: a partial rollout can lock admins out — do it atomically + test that Bryan (super_admin) retains
  full access before deploy.
- `middleware.ts` matching `/admin/*` as defense-in-depth (server actions are independently reachable POST
  endpoints; the layout gate doesn't protect them). Confirm no `middleware.ts`/`proxy.ts` exists yet.

### 6b. Audit hardening (P1)
- `admin_activity_log`: make append-only — `REVOKE UPDATE, DELETE` from all roles; inserts only via a
  `SECURITY DEFINER` function (migration). Capture before/after (or full snapshot on deletes) + a REQUIRED
  `reason` on destructive actions. Make logging part of the same path as the mutation so "no log ⇒ no action".
- Refactor `lib/admin/activity-log.ts` (`logAdminAction`) + all call sites accordingly (it currently fails
  open — swallows insert errors, post-hoc).
- Log Stripe webhook state changes too (currently unlogged).

### 6c. Soft-delete + manual purge (P0/P1, locked decision)
- Migration: `deleted_at timestamptz` on `organizations` (+ users handled via auth ban + a tombstone marker).
  Delete actions (`deleteOrg`, `deleteUser` cascade, `clearTestData`) → set `deleted_at` + hide from lists,
  instead of hard-deleting. Pre-delete snapshot to an archive table or Blob.
- Separate **manual-trigger purge** action (super_admin) that hard-removes soft-deleted rows via the existing
  `cascadeDeleteOrganization`. (Optionally a later scheduled sweep.) Update all list queries to exclude
  `deleted_at IS NOT NULL`.

### 6d. Impersonation hardening (P0)
- Replace the raw magic-link return (`impersonateUser`) with a session-flagged impersonation: carry
  actor_admin_id + target_user_id + expiry; sign in server-side + redirect (don't hand a portable login token
  to the client). Time-box (~15–30 min), read-only by default (block destructive/billing while impersonating),
  full-session banner ("Viewing as <user> — admin <email> — exit"), dual attribution in the audit log.

### 6e. Rate limits + transactional cascades (P1)
- Rate-limit destructive actions per-admin (Upstash/Vercel KV or a DB counter).
- Wrap the multi-statement cascades (`cascade-cleanup`, `deleteUser`) in a `SECURITY DEFINER` Postgres fn so
  they're atomic (today they're sequential service-role writes; idempotent but not atomic).

## Review requirement
Phase 6 is access-control. Run an adversarial review (workflow) BEFORE each deploy, same as Phases 2 & 4
(those caught 6 + 5 real bugs). Specifically verify: no capability gap that lets a lower role do a higher
action; the roles migration can't lock out super_admins; soft-delete doesn't leave hard-delete paths
reachable; impersonation can't be escalated; audit is genuinely append-only.

## Carry-over low items (fold in opportunistically)
- `deleteUser` post-cascade writes (membership detach, profiles null, platform_admins, waitlist) are
  unchecked — they're cascade-redundant/best-effort today; tighten under audit hardening.
- `clearTestData` real-run re-queries targets (minor TOCTOU vs the previewed count) — pass previewed IDs.
- Shared `ConfirmDialog`/`TypedConfirmDialog` extraction (Phase 5 left inline typed-confirm panels — work
  fine; extract for consistency).
- Bush's/Cane's are still `org_kind='real'` — tag them `demo` via the now-shipped Set Kind UI (no SQL).
