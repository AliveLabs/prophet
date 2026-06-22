# TicketAdmin Rebuild — Plan / PRD

**Status:** Proposal (rev 2, 2026-06-22) · **Owner:** Bryan · **Scope:** Vatic platform admin (serves Ticket + Neat)
**Authors:** synthesized from a 4-lens pass (current-state audit, backend/platform architecture, product/UX, security) + Bryan's design refinements.

---

## 0. TL;DR — the reframe

The admin panel is **more built than it looks**. The audit found `delete user` (cascade + modal), `send magic link` (= password reset; Ticket is passwordless), `impersonate`, `rename org`, `edit profile`, `ban/unban`, tier change, trial extend/reset, and waitlist approve/decline/resend **already exist and are wired**.

So this is four things, not a from-scratch build:
1. **Fill genuine gaps** — org delete, set *exact* trial date, true Stripe convert-to-paid, admins-vs-users separation.
2. **Add the demo/test system** — `org_kind` tagging, admin-only creation, safe bulk clearing.
3. **One canonical cleanup module** — every delete path shares one complete cascade (fixes the orphaned-rows bug).
4. **Harden safety** — confirmation system, roles, impersonation, audit.

Plus the design refinements in **§2.5 (delete vs clear vs transfer)** and **§2.6 (onboarding tombstone)**, which change how we think about the destructive actions.

**Account-kind decision (locked):** `org_kind` defaults to **Customer (`real`)**. Demo/test orgs are created only from TicketAdmin — but kind is **editable afterward in Manage** (§2). Three independent axes that must never be coupled: **kind** (Customer/Demo/Test), **onboarding-state** (onboarded / needs-onboarding), **account-status** (active/suspended).

---

## 1. Current-state gap matrix

✅ exists & wired · 🟡 backend exists, UX weak · ❌ missing.

| Capability | State | Rebuild action |
|---|---|---|
| List/view/search orgs & users | ✅ | Keep; add kind badge + filter |
| Rename org / edit billing email | ✅ (`updateOrgInfo`) | Extend to slug, industry, **kind** ("edit core fields") |
| Change tier | ✅ | Add confirm; guard Stripe-backed orgs |
| Trial extend / reset | ✅ | Keep |
| **Set exact trial end date** | ❌ | **New** `setTrialEndsAt` + date picker |
| Activate / deactivate (suspend) org | ✅ | Keep; deactivate should also cancel Stripe sub |
| **Delete org (full)** | ❌ | **New** `deleteOrg` on canonical module |
| **Clear org data (keep shell)** | ❌ | **New** `clearOrgData` (cascade minus the org row) — see §2.5 |
| **Transfer org ownership** | ❌ | **New** `transferOrgOwnership` — see §2.5 |
| **Remove user from org** | 🟡 (only via deleteUser) | **New** standalone membership revoke |
| **Convert-to-paid (real Stripe)** | 🟡 (checkout exists) | **New** `convertOrgToPaid` |
| **Create demo/test org** | ❌ | **New** create flow + `org_kind` (two onboarding modes, §2.6) |
| **org_kind classification + editing** | ❌ | **New** column + badges + filters + **Manage editor (all 3)** |
| Edit user profile / email | ✅ | Keep |
| Deactivate/activate (ban) user | ✅ | Keep |
| **Delete user** | ✅ (cascades sole-owner orgs) | **Rework** → preserve orgs by default; branch to cascade (§2.5); typed-confirm |
| **Tombstone / re-onboard a user** | ❌ | **New** reset onboarding without touching kind — §2.6 |
| Password reset (= magic link) | ✅ | Keep; **add universal "resend"** (§3c) |
| Impersonate user | ✅ | **Harden** (session-flag, time-box, banner, dual-audit) |
| Invite user / admin | ✅ | Keep; admin invite should actually email; **resend** |
| **Separate admins from users in list** | 🟡 | **New** Users/Admins tabs + `ADMIN` badge |
| **Waitlist un-approve / revert** | ❌ (hand-fixed in prod 2026-06-22) | **New** `unapproveWaitlistSignup` (§3c) |
| Waitlist approve/decline/resend/batch | ✅ | Keep; **fix duplicate-org-on-reapprove bug** |
| Audit log viewing | ✅ | Harden (append-only, before/after, reason) |

Pre-existing bugs to fix opportunistically: `deactivateOrg` doesn't cancel the Stripe sub; waitlist batch ops aren't transactional; **`approveWaitlistSignup` creates a duplicate org on re-approve** (was task `task_5604320a`, now folded here); Stripe webhook state changes aren't audit-logged.

---

## 2. Account model — `org_kind` (Customer / Demo / Test)

- Column `org_kind text NOT NULL DEFAULT 'real'`, CHECK in (`real`,`demo`,`test`). **UI labels: Customer (=`real`) / Demo / Test.** Orthogonal to `industry_type` (a Neat demo is `org_kind='demo'` + `industry_type='liquor_store'`).
- **Three independent axes — never coupled:** (1) **kind** (Customer/Demo/Test), (2) **onboarding-state** (onboarded / needs-onboarding — §2.6), (3) **account-status** (active/suspended). Clearing data, tombstoning, or re-onboarding NEVER changes `org_kind`.
- **Creation path sets the *initial* kind:** signup/waitlist ⇒ Customer; TicketAdmin create flow ⇒ Demo/Test.
- **Editable in Manage across all three** (Bryan): the org Manage screen has a Customer/Demo/Test control. `demo`↔`test` = simple confirm. Setting an existing untagged org → Demo/Test (an internal account that slipped in as Customer) must be easy. Flipping **→ Customer** is the guarded one (makes it billable + removes it from the clear blast radius) → `super_admin`, typed-confirm.
- **Attachment:** kind lives on the **organization** (that's what billing/analytics/clear care about). The user/login Manage screen surfaces the kind of orgs they own and offers the tombstone action (§2.6). A user-level `is_internal` flag is possible later if we ever need test *users* with no org — not now.
- **Three hard guards (security P0), in code *and* DB:** (1) **Billing** — charge paths reject non-Customer; (2) **Analytics** — rollups filter `org_kind='real'` via one `REAL_ORG_FILTER` helper; (3) **Clear-test** — bulk clear targets `test`[`+demo`] only, aborts if any Customer org is in the set.
- Migration backfills nothing (existing rows default to Customer). Bush's + Cane's tagged `demo` in a separate reviewed statement.

## 2.5 Account operations model — delete vs. clear vs. transfer

Bryan's key point: **"delete" conflates three separable things** — the user account, the membership/ownership, and the org's data. Separating them gives a clean set, and most real use cases need the *non*-destructive ones.

**Operations:**
- **Transfer ownership (A→B)** — NEW. The prerequisite for clean manager transitions.
- **Remove user from org** — revoke one membership; user + org both survive.
- **Delete user (preserve orgs)** — NEW DEFAULT. Delete the login; if the user solely owns an org, the admin must first **transfer ownership** or explicitly opt into deleting those orgs. Deleting a user no longer silently burns their org's history.
- **Delete user + sole-owner orgs** — today's cascade, now an explicit opt-in branch.
- **Refresh data / Clear all data (keep the shell)** — NEW, two flavors (§8.1, labels tentative): **Refresh data** wipes derived intelligence (insights, snapshots, signals, competitors, jobs, social) but keeps locations; **Clear all data** also removes locations → true pre-onboarding state. Both keep the org row, identity, billing, members → re-onboardable. Mechanically = the canonical cascade *minus* the final `organizations` row delete (Clear-all also drops locations). "Reset" rejected as too soft a word.
- **Delete org (full)** — complete cascade incl. the org row.
- **Suspend / reactivate** — existing soft state.

**Use case → operation:**

| Use case | Operation | Implication |
|---|---|---|
| Manager leaves, new one starts | Transfer ownership A→B, then optionally delete user A | Org + all history preserved |
| Bad/duplicate user on an org | Remove from org (or delete user, preserve orgs) | Org data untouched |
| Disposable test account + junk org | Delete user + sole-owner orgs (opt-in) | Everything gone |
| Returning customer / refresh stale demo | **Clear data** + tombstone owner | Tenant + billing survive; derived data wiped; re-onboards fresh |
| Re-demo onboarding on a demo account | Tombstone the demo user | Rehearse onboarding repeatedly; kind stays Demo |
| Customer churns, may return | Suspend → later Clear+re-onboard or Delete | Soft path first |
| Wrong waitlist approval (today's incident) | Un-approve = delete auto-created user+org, reset signup→pending | Same delete path, one click |
| GDPR erasure | Delete user + delete org (hard) + snapshot then purge | Fully removed, audit snapshot kept |

**Rules that fall out:** deleting a user ≠ deleting their orgs; "clear" and "delete" are distinct and both get built; ownership-transfer is first-class; all three operate through the one canonical cleanup module (clear = cascade without the org-row delete).

## 2.6 Onboarding & the "tombstone" (re-onboard without losing the flag)

Demo/test must **not circumvent onboarding** — we need to demo and QA the onboarding experience itself.
- **Demo/test creation offers two modes:** *Ready-to-show* (skip onboarding, seeded + data pulled) or *Fresh* (lands at onboarding, to rehearse the flow).
- **Tombstone a user** = reset their onboarding state so next login routes them back through onboarding, **without** changing `org_kind`. Re-run onboarding on the same flagged account indefinitely.
- Onboarding completion is currently inferred from `profiles.current_organization_id` (+ the org having a location). Tombstone implementation must confirm the exact gate in `app/onboarding/` and reset it (likely null `current_organization_id` and/or clear onboarding artifacts) — never touching `org_kind` or billing.

---

## 3. Backend / data-model changes

### 3a. Canonical cascade-cleanup module — `lib/admin/cascade-cleanup.ts`
Single source of truth. **`deleteUser`, `deleteOrg`, `clearOrgData`, and `clearTestData` all call it.** Fixes the 2026-06-22 bug where the bulk script relied on DB cascade only and left orphaned **polymorphic** `social_profiles`/`social_snapshots` (keyed by `entity_type`/`entity_id`, no org FK).

`cascadeDeleteOrganization(admin, orgId, { keepShell?: boolean })` — order:
1. Resolve `locations`→`locationIds`, `competitors`→`competitorIds`.
2. Delete polymorphic `social_profiles` for those entity ids **before** the org (once locations are gone the link is unrecoverable). `social_snapshots` fall via their FK to `social_profiles`.
3. Null `profiles.current_organization_id = orgId` (this FK is `RESTRICT`).
4. Delete org-scoped data; if `keepShell` → stop here (this is **Clear**); else `DELETE FROM organizations` (this is **Delete**).
5. (Caller) re-point nulled multi-org users. Idempotent. Auth is the caller's job.

### 3b. Shared org factory — `lib/admin/org-factory.ts`
Extract org creation from `approveWaitlistSignup` into `createOrgWithOwner(...)`; reused by waitlist-approve, `createDemoOrg`, `createTestOrg`. Removes copy-paste drift and is where the **duplicate-org-on-reapprove** fix lives (look up existing org by `waitlist_signup_id` before inserting).

### 3c. New / changed server actions
- **`deleteOrg(orgId)`** — cancel Stripe sub if active → `cascadeDeleteOrganization` (full) → log.
- **`clearOrgData(orgId)`** — `cascadeDeleteOrganization(keepShell:true)` → log `org.clear_data`. Optionally tombstone owner.
- **`transferOrgOwnership(orgId, fromUserId, toUserId)`** — reassign owner membership; validate target is/Becomes a member; log.
- **`removeUserFromOrg(orgId, userId)`** — revoke one membership (guard: not the sole owner unless transferring/deleting); log.
- **`deleteUser(userId, { orgStrategy: 'preserve' | 'cascade' })`** — rework. `preserve` (default): block if sole-owner of any org unless ownership transferred; never deletes orgs. `cascade`: today's behavior, explicit opt-in. Routes through canonical module. Typed-confirm. Self-delete guard stays.
- **`setOrgKind(orgId, kind)`** — Customer/Demo/Test; guard →Customer (super_admin, typed-confirm).
- **`tombstoneUser(userId)` / re-onboard** — reset onboarding state (§2.6); does not touch kind.
- **`setTrialEndsAt(orgId, isoDate)`** — absolute setter; Stripe-trialing orgs route through `subscriptions.update({trial_end})`, else write column.
- **`convertOrgToPaid(orgId, {tier,cadence})`** — generates a Stripe **Checkout link** (existing `/api/stripe/checkout` flow) and surfaces/sends it to the owner; **no admin-initiated charge** (these use cases won't have a card on file). Webhook (`checkout.session.completed` → `applySubscriptionToOrg`) flips `payment_state='active'`. Rejects non-Customer.
- **`createDemoOrg` / `createTestOrg`** — via `createOrgWithOwner`, owner = admin, **1yr default trial (overridable/resettable via `setTrialEndsAt`)**, no Stripe; **mode = Ready-to-show | Fresh** (§2.6).
- **`clearTestData({ includeDemo=false, allowlist=[], dryRun=true })`** — bulk, on canonical module; dry-run default; abort-on-Customer-org.
- **`unapproveWaitlistSignup(signupId)`** — NEW (folds in `task_5604320a`): set `waitlist_signups.status='pending'`, clear `reviewed_by`/`reviewed_at`, delete the org created from the signup (`waitlist_signup_id`) + its members + the auto-created auth user (via canonical paths). Gate + log. (This is exactly the 2026-06-22 hand-fix, productized.)
- **Universal `resend`** — a shared affordance for every email-triggering action (waitlist invite, admin invite, user invite, magic-link/password-reset, decline notice). `resendWaitlistInvite` + `sendUserMagicLink` already exist; generalize into one consistent "Resend" control wherever an email was/should be sent, with throttle + audit (`*.resend`).

---

## 4. Screens / IA

Nav: `Overview · Waitlist · Users · Organizations · Demo & Test · Maintenance · Settings`

- **Overview** — triage band: Expiring Trials (7d, color-ramped), Demo/Test inventory counts, recent admin activity.
- **Organizations list** — kind badge (Customer = no badge), kind filter, secondary "+ New Demo/Test Org".
- **Create Demo/Test Org** (`/admin/organizations/new`) — kind (Demo/Test), **onboarding mode (Ready-to-show / Fresh)**, name, industry (config-driven), optional seed location, owner = you. Success → org detail + "Pull data now".
- **Org detail / Manage** — prominent **trial banner** ("expires in N days — on DATE"); **kind editor (Customer/Demo/Test)** in Manage; action bar in 3 fenced clusters:
  - *Trial & billing:* change tier, +7/+14/+30, **set exact end date**, reset.
  - *Edit:* core fields (name, billing email, slug, industry, **kind**).
  - *Danger zone (right-aligned):* convert-to-paid, suspend/activate, **Clear data**, **Delete org**, **Transfer ownership**. Clear vs Delete are visually distinct ("Clear data — keeps the org, wipes intelligence" vs "Delete org — removes everything").
- **Users list** — **Users / Platform Admins tabs** + `ADMIN` badge on admins among users. Row: View, Activate/Deactivate, **⋯ overflow** (send/**resend** magic link, impersonate, send email, **remove from org**). Delete stays detail-only.
- **User detail / Manage** — 3-cluster grouping; **resend** on invite/magic-link; **Tombstone (re-onboard)** action; delete = typed-confirm with the **preserve-orgs vs cascade** branch + a transfer-ownership prompt if sole owner.
- **Waitlist** — add **Un-approve** on `approved` rows (reverts to pending, cleans up the auto-created org+user); **Resend** on invite/decline. Keep approve/decline/batch.
- **Demo & Test** (`/admin/sandbox`) — inventory of non-Customer orgs; primary "+ New"; multi-select batch delete (typed-count). Server-guarded to never touch Customer orgs.
- **Maintenance** (`/admin/maintenance`) — clear-test-data: scope → **Preview (dry run)** list → typed-count confirm.

### Destructive-action confirmation system
- **Tier 1 — Simple Confirm** (reversible): tier change, suspend/activate, reset/set trial, deactivate user, impersonate, demo↔test, remove-from-org, **resend**. Styled `ConfirmDialog` (replaces native `window.confirm`).
- **Tier 2 — Typed Confirmation** (irreversible/financial/bulk): delete user, delete org, **clear org data**, convert-to-paid, bulk clear, →Customer reclassify, un-approve. Type the entity name/count; extra acknowledgement checkbox for deleting a *Customer* org or any clear-test run.

---

## 5. Safety & security model

**P0:** roles — **3 tiers** (Super Admin = Bryan+Chris / Admin / Read-only, §8.3) via a `withAdminAction(capability, fn)` wrapper + `/admin/*` middleware; **soft-delete** (mark `deleted_at`, hidden) + pre-delete snapshot + typed confirm on delete user/org, with a separate **manual-trigger purge** to hard-remove later; **no second-admin approval** (typed-confirm only); `org_kind` guards (billing/analytics/clear) in code + DB; clear-test dry-run + abort-on-Customer; impersonation hardening (session-flag, time-box, read-only default, banner, dual attribution; stop returning raw magic links).

**P1:** transactional cascades via `SECURITY DEFINER` fn; rate limits on destructive actions; audit hardening (in-transaction, before/after, required reason, append-only `REVOKE UPDATE/DELETE`, external sink); `resetOrgTrial`/`activateOrg` refuse/extra-confirm when `payment_state='active'`.

**P2:** hash-chained audit, break-glass procedure, user-facing impersonation notice.

> The 2026-06-22 cleanup pulled the prod service-role key via `vercel env pull` (ephemeral, deleted after, never committed) — rotation is low-urgency. The lasting fix is making the audited admin action the only prod-mutation path, so no one hand-edits prod again. These actions *are* that path.

---

## 6. Neat / Vatic generalization

100% shared screens + org spine; only a small **per-product config** differs: `industries`, tier labels/colors, brand name/logo. `org_kind`, the operations model, cleanup, tombstone, and confirmations are all product-agnostic. Enforce the config seam *before* adding screens so Neat is free. Audit namespaces stay product-neutral (`org.*`, `user.*`, `maintenance.*`, `waitlist.*`).

---

## 7. Phased rollout

| Phase | Deliverable |
|---|---|
| **0 — Hygiene** | Sweep orphaned `social_profiles`/`social_snapshots` left by the 2026-06-22 bulk clear |
| **1 — Foundation** | `org_kind` migration + `cascade-cleanup.ts` (w/ `keepShell`) + `org-factory.ts` (+ fix duplicate-org bug) + tag Bush's/Cane's demo + billing/analytics guards |
| **2 — Operations model** | `transferOrgOwnership` + `removeUserFromOrg` + `clearOrgData` + rework `deleteUser` (preserve/cascade) + `deleteOrg` + `setOrgKind` + `tombstoneUser`; the delete/clear/transfer use-case set (§2.5/§2.6) |
| **3 — Demo/Test system** | `createDemoOrg/Test` (2 onboarding modes) + `/admin/organizations/new` + `/admin/sandbox` + `clearTestData` (dry-run) + `/admin/maintenance` |
| **4 — Org lifecycle gaps** | `setTrialEndsAt` + `convertOrgToPaid` + edit-core-fields + trial banner; `deactivateOrg`→cancel sub |
| **5 — Users IA + waitlist + resend + confirms** | Users/Admins tabs + `ADMIN` badge + action clustering + ⋯ overflow + typed-confirm delete + shared `ConfirmDialog`/`TypedConfirmDialog` + **waitlist un-approve** + **universal resend** |
| **6 — Security hardening** | Roles/capabilities + `withAdminAction` + middleware + impersonation hardening + audit hardening |
| **7 — Neat generalization** | Per-product config seam |

---

## 8. Decisions (locked 2026-06-22)

1. **Clear vs delete — support all three, destructive-accurate labels** (labels tentative, reword freely; "Reset" rejected as too soft):
   - **Refresh data** — keep org + locations, re-pull/wipe derived intelligence (least destructive).
   - **Clear all data** — remove locations + all data, keep org shell + billing + members; owner re-onboards (destructive).
   - **Delete organization** — remove everything incl. the org row (most destructive).
2. **`deleteUser` default = preserve orgs.** ✓ Sole-owner deletes require a transfer or an explicit cascade opt-in.
3. **Roles — 3 clear tiers** (split billing out later only if needed): **Super Admin** (Bryan + Chris) = everything incl. manage-admins, hard-delete, billing, →Customer reclassify · **Admin** = day-to-day (view/edit, trial extend, magic-link/resend, impersonate, create + clear demo/test, deactivate) but NOT hard-delete of Customer orgs/users, billing conversion, manage-admins, or →Customer · **Read-only** = view + export.
4. **Soft-delete + manual purge.** Users/orgs soft-delete (mark `deleted_at`, hidden); a separate **manual-trigger purge** action permanently removes them later (a scheduled sweep can be added after).
5. **No second-admin approval.** Typed-confirmation is sufficient.
6. **Demo expiry = long default (1yr), overridable/resettable** (not truly never-expiring) so stale demos surface; admins can extend/reset.
7. **Convert-to-paid = send Checkout link** (no admin-initiated charge — these use cases won't have a card on file).
