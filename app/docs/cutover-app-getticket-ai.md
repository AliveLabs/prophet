# Production cutover runbook: thevatic.com → app.getticket.ai

> **Date:** April 29, 2026
> **Owner:** Anand Iyer
> **Status:** Code shipped; external dashboards + DNS pending
> **Scope:** Restaurant / Ticket vertical only. Neat is deferred to its own
> `vatic-core` clone.
>
> This is the operational companion to the code changes shipped in commit
> `[the-cutover-commit-sha]` and to the plan
> `.cursor/plans/app-getticket-cutover_356ff7e9.plan.md`. Read top to bottom in
> order — every step blocks the next until verified.

---

## 0. Architecture target

| Surface          | Restaurant (Ticket)                  | Liquor (Neat, future)             |
| ---------------- | ------------------------------------ | --------------------------------- |
| Marketing site   | `https://www.getticket.ai` (live)    | `https://www.useneat.ai` (later)  |
| Application      | `https://app.getticket.ai` (this cutover) | `https://app.useneat.ai` (later) |
| Vercel project   | `prophet` (Alive Labs team)          | clone of `vatic-core`             |
| Marketing project | `ticket-marketing` (Alive Labs team, live) | `neat-marketing` (already provisioned) |
| Supabase project | shared with Neat (until Neat clones DB) | same                          |
| Stripe account   | shared with Neat (until Neat clones)    | same                          |

**Vercel project IDs (Alive Labs team `team_Xd2amCYMKjcunazwnwELO5es`):**

- `prophet`           = `prj_2tOyRG3xJAoGirjpOCvQmGiOfaVh` (the app)
- `ticket-marketing`  = `prj_5pxaaaYVJs1RC59nFtUYrTPouYqL` (Bryan)
- `neat-marketing`    = `prj_s8ssXjyK6U2KBzLhhGUTtT6xHeFu` (Bryan, dormant)

**`.vercel/project.json` correction needed:** the local `.vercel/project.json` in
this repo currently points at the *empty* `prophet` project on the personal
team `team_E1RDbY0TvYdArGMoSgTsdR5w` (Anand's). Re-link to the Alive Labs team
before any `vercel` CLI command:

```bash
vercel link --project prophet --scope alive-labs --yes
```

---

## 1. Pre-flight (no production impact)

### 1.1 Snapshot rollback baseline

| Item                            | Value at start of cutover |
| ------------------------------- | ------------------------- |
| Production deployment SHA       | `dpl_CT6qb9UgA6UAVUocYG7NtUZAm17t` (latest before cutover) |
| Production aliases on `prophet` | `www.thevatic.com`, `thevatic.com`, `www.getvatic.com`, `getvatic.com` + 3 auto `*.vercel.app` URLs |
| Marketing aliases on `ticket-marketing` | `getticket.ai`, `www.getticket.ai` + auto URLs |
| `NEXT_PUBLIC_APP_URL` (prod)    | _capture before flipping_ |
| `MARKETING_CONTACTS_ENABLED`    | _capture before flipping_ |
| `CLIENT_EMAILS_ENABLED`         | _capture before flipping_ |

Capture all production env vars before you change anything:

```bash
vercel env ls production --scope alive-labs
vercel env pull .env.production.snapshot --environment=production --scope alive-labs
```

If anything breaks, `vercel rollback dpl_CT6qb9UgA6UAVUocYG7NtUZAm17t --scope alive-labs`.

---

## 2. DNS + Vercel domain provisioning

### 2.1 Bryan: add CNAME

The `getticket.ai` zone is on Bryan's DNS provider (already configured for the marketing site at apex + `www`). Send him this exact record:

```
Type:   CNAME
Name:   app
Value:  cname.vercel-dns.com
TTL:    300
```

After it propagates, `dig +short app.getticket.ai` returns `cname.vercel-dns.com`.

### 2.2 Add the alias to the prophet Vercel project

In the Alive Labs Vercel dashboard → `prophet` project → **Settings → Domains → Add**: `app.getticket.ai`.

Vercel will issue an SSL cert (1-5 minutes after DNS propagates).

**Do not** mark it as the production domain yet. Add it as a secondary alias so you can deploy and smoke-test before flipping production.

### 2.3 Sanity check

```bash
dig +short app.getticket.ai      # expect cname.vercel-dns.com or final A record
curl -sI https://app.getticket.ai | head -5  # expect HTTP/2 200 or 308 with valid TLS
```

If TLS fails after 10 minutes, re-issue from Vercel dashboard.

---

## 3. Code changes (already shipped in this commit)

For traceability, here's everything that changed in the repo. Nothing in this section needs human action — it's done.

### 3.1 Hardcoded domain literals (5 files)

| File | What changed |
| ---- | ------------ |
| `lib/email/templates/layout.tsx` | Email logo URL fallback `https://www.thevatic.com` → `https://app.getticket.ai` |
| `lib/email/send.ts` | `FROM_ADDRESS_TICKET` now `Ticket <hello@getticket.ai>` (overridable via `RESEND_FROM_TICKET` env). `FROM_ADDRESS_NEAT` unchanged (`goneat.ai`, deferred). |
| `lib/stripe/client.ts` | Stripe `appInfo.url` `https://getvatic.com` → `https://app.getticket.ai` |
| `app/api/stripe/webhook/route.ts` | Replaced duplicated From literals with imports of `FROM_ADDRESS_TICKET`/`FROM_ADDRESS_NEAT` |
| `scripts/stripe/setup.ts` | Customer Portal `business_profile.{privacy_policy_url,terms_of_service_url}` now point at `https://www.getticket.ai/{privacy,terms}` (Ticket) and `https://www.useneat.ai/{privacy,terms}` (Neat). Comment + error message updated to `https://app.getticket.ai`. |

### 3.2 `/api/waitlist` CORS + UTM

`app/api/waitlist/route.ts` rewrite:

- `ALLOWED_ORIGINS` includes `https://getticket.ai`, `https://www.getticket.ai`, plus localhost ports for dev.
- `OPTIONS` handler returns 204 + CORS headers for allow-listed origins, 403 (no headers) for everyone else.
- All POST responses (200/400/409/500) carry `Access-Control-Allow-Origin: <echoed-origin>` when the origin is allow-listed.
- Body schema accepts `business_name`, `source`, `industry_type`, `utm_*`. Cross-origin `getticket.ai` POSTs force `industry_type='restaurant'`.
- UTMs persisted as JSON in `waitlist_signups.notes` (no migration).
- `marketing.contacts.source` set explicitly per signup (was inheriting DB default).

### 3.3 Cron bug fix

`app/api/cron/daily/route.ts:108-110` operator-precedence error fixed. The old expression `A ?? B ? expr1 : expr2` parsed as `(A ?? B) ? expr1 : expr2`, silently routing the daily refresh job at `https://${VERCEL_URL}` (auto-generated deployment URL) instead of `NEXT_PUBLIC_APP_URL`. Now correctly: `A ?? (B ? expr1 : expr2)`.

### 3.4 `lib/marketing/contacts.ts`

`UpsertMarketingContactInput` gains a `source?: MarketingSource` field (typed against the `marketing.contacts.contacts_source_chk` allow-list). Forwarded into the upsert payload.

### 3.5 Documentation

- `.env.example` — updated comments for `NEXT_PUBLIC_APP_URL`, added `RESEND_FROM_TICKET`/`RESEND_FROM_NEAT` overrides
- `BLUEPRINT.md` — Last updated header, `NEXT_PUBLIC_APP_URL` row in §3 marked required-in-prod with the full callsite list
- `app/docs/Stripe Production.md` — all `thevatic.com` / `getvatic.com` references → `app.getticket.ai`
- `app/docs/POST_APRIL16_PRD.md` — header note that placeholder URLs resolve to `app.getticket.ai`
- `scripts/stripe/README.md` — example URLs

---

## 4. External dashboards (HUMAN ACTION REQUIRED)

This is where the real cutover work happens. Do these in order; each precondition is enforced by the next.

### 4.1 Vercel env vars (Alive Labs team → `prophet` → Settings → Environment Variables)

Set on **Production** scope:

| Variable                     | Value                          | Notes                                       |
| ---------------------------- | ------------------------------ | ------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`        | `https://app.getticket.ai`     | Single most load-bearing change             |
| `MARKETING_CONTACTS_ENABLED` | `true`                         | Enables `marketing.contacts` mirror used by Chris's drip |
| `CLIENT_EMAILS_ENABLED`      | `false`                        | Pauses platform-side client-facing email per `POST_APRIL16_PRD.md` Workstream 1 |
| `RESEND_FROM_TICKET`         | _set only if Resend verification not yet complete (see 4.5)_ | e.g. `Ticket <onboarding@resend.dev>` |

Apply, then **trigger a redeploy** of the latest production deployment so the new env vars take effect (Vercel does not redeploy automatically on env-var change).

### 4.2 Supabase dashboard (Authentication)

Project → **Authentication → URL Configuration**:

- **Site URL:** `https://app.getticket.ai`
- **Redirect URLs (allow-list):** add the following (keep old entries during transition window):
  - `https://app.getticket.ai/auth/callback`
  - `https://app.getticket.ai/**` (covers any future paths)
  - `https://www.thevatic.com/auth/callback` ← keep for 7 days, then remove
  - `https://*.vercel.app/auth/callback` (if not already, for preview deploys)

Spot-check: Authentication → Email Templates → Magic Link. The `{{ .SiteURL }}` token now resolves to the new domain.

Project → **API → Settings → Exposed schemas:** confirm `marketing` is listed. (Required for the contacts mirror; documented in `lib/marketing/contacts.ts` comment.)

### 4.3 Stripe dashboard

#### Webhooks (Live mode)

Stripe Dashboard → **Developers → Webhooks**:

- Open the existing endpoint pointing at `https://www.thevatic.com/api/stripe/webhook`.
- **Update endpoint URL** to `https://app.getticket.ai/api/stripe/webhook`. The signing secret is preserved on URL update — no env-var rotation needed.
- Click "Send test webhook" with event `customer.subscription.updated`. Verify 200 in the response.

Repeat for **Test mode**.

#### Customer Portal configurations

Two options:

**(A) Recommended — re-run the setup script** (idempotent, picks up new `marketingBase` URLs from the code change in 3.1):

```bash
# Test mode first
STRIPE_SECRET_KEY=sk_test_... \
APP_URL=https://app.getticket.ai \
npx tsx scripts/stripe/setup.ts

# Then live
STRIPE_SECRET_KEY=sk_live_... \
APP_URL=https://app.getticket.ai \
npx tsx scripts/stripe/setup.ts
```

The script will UPDATE the existing portal configs in place (matched by `metadata.vatic_key`). It also updates the webhook URL idempotently; no harm in running it twice.

**(B) Manual** — Stripe Dashboard → **Settings → Billing → Customer Portal** → Edit each config (Ticket and Neat):

- Privacy policy URL: `https://www.getticket.ai/privacy` (Ticket), `https://www.useneat.ai/privacy` (Neat — non-functional until Neat ships)
- Terms of service URL: same swap with `/terms`
- Headline unchanged.

#### Account business URL

Stripe Dashboard → **Settings → Account details** → **Business URL** → `https://www.getticket.ai`. (Marketing site, not the app.) This appears in customer receipts and Stripe's verification UI.

### 4.4 Google Cloud Console (OAuth)

Strong recommendation: create a **new** OAuth 2.0 Client for Ticket rather than adding redirect URIs to the existing one. Sets the pattern for Neat's clone.

Google Cloud Console → **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**:

- Application type: **Web application**
- Name: `Ticket Web — Production`
- Authorized JavaScript origins:
  - `https://app.getticket.ai`
  - `http://localhost:3000` (dev)
- Authorized redirect URIs:
  - `https://app.getticket.ai/auth/callback`
  - `http://localhost:3000/auth/callback` (dev)

Grab the new `client_id` + `client_secret`. Update Vercel env:

- `GOOGLE_CLIENT_ID` → new client ID
- `GOOGLE_CLIENT_SECRET` → new client secret

Keep the old OAuth client live for 7 days during transition (Supabase OAuth provider config holds one client at a time, so you have to flip; old tokens stop working after the flip — schedule for low-traffic time).

Supabase → **Authentication → Providers → Google** → paste the new client ID + secret. Save.

### 4.5 Resend (transactional email)

Resend Dashboard → **Domains → Add Domain** → `getticket.ai`.

Resend prints DNS records to add on the **`getticket.ai` apex zone**. Send these to Bryan:

- 1× TXT record (SPF, e.g. `v=spf1 include:_spf.resend.com ~all`)
- 3× CNAME records (DKIM, names like `resend._domainkey.getticket.ai`)
- 1× MX record (optional, for return-path)
- 1× TXT record (DMARC, recommended `v=DMARC1; p=none; rua=mailto:dmarc@getticket.ai`)

Verification typically completes in minutes once Bryan adds the records. While pending, set `RESEND_FROM_TICKET=Ticket <onboarding@resend.dev>` in Vercel env so emails still send via Resend's shared sandbox domain.

After `getticket.ai` is verified in Resend:

- Remove `RESEND_FROM_TICKET` env var
- `lib/email/send.ts` defaults to `Ticket <hello@getticket.ai>`
- Verify a test send from `/admin/users` → "Send custom email" lands without spam-folder routing

### 4.6 PostHog

PostHog Dashboard → **Project Settings → Authorized URLs** → add `https://app.getticket.ai`.

The `/ingest` reverse proxy in `next.config.ts` is domain-agnostic, but PostHog enforces an origin allow-list at the project level for SDK ingestion.

---

## 5. Cutover sequence

### 5.1 Smoke test on `app.getticket.ai` BEFORE promoting

With `app.getticket.ai` attached as a secondary alias and env vars updated, run through this checklist on the new URL:

- [ ] `https://app.getticket.ai` loads, marketing landing renders, dark/light theme works
- [ ] `/login` magic link → email arrives → link is `https://app.getticket.ai/auth/callback?...` → click → land in `/home` or `/onboarding`
- [ ] Google OAuth → consent screen returns to `https://app.getticket.ai/auth/callback`
- [ ] Stripe Checkout from `/settings/billing` → success_url = `https://app.getticket.ai/settings/billing?upgraded=true`
- [ ] Stripe Customer Portal → "Return to Ticket" link points at `https://app.getticket.ai/settings/billing`
- [ ] Stripe webhook → manually trigger `customer.subscription.updated` from Stripe Dashboard → 200 from new URL → row in `public.stripe_webhook_events`
- [ ] Trial reminder email → manually invoke `GET /api/cron/trial-reminders` with `Authorization: Bearer $CRON_SECRET` → portal/cancel URLs in email body are on new host
- [ ] Welcome email → complete onboarding for a test user → `dashboardUrl` in email = `https://app.getticket.ai/home`
- [ ] Daily cron → manual `GET /api/cron/daily` with bearer → confirm internal `/api/jobs/refresh_all` self-fetch hits `app.getticket.ai` (validates the cron bug fix in 3.3) — check Vercel runtime logs

### 5.2 Curl smoke tests for CORS

```bash
# Allowed preflight
curl -i -X OPTIONS https://app.getticket.ai/api/waitlist \
  -H 'Origin: https://getticket.ai' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type'
# Expect 204 with Access-Control-Allow-Origin: https://getticket.ai

# Disallowed preflight
curl -i -X OPTIONS https://app.getticket.ai/api/waitlist \
  -H 'Origin: https://evil.example.com'
# Expect 403, no CORS headers

# Happy path POST
curl -i -X POST https://app.getticket.ai/api/waitlist \
  -H 'Origin: https://getticket.ai' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "smoke-test+1@alivelabs.io",
    "first_name": "Smoke",
    "last_name": "Test",
    "business_name": "Test Cafe",
    "source": "getticket.ai",
    "industry_type": "restaurant",
    "utm_source": "manual-curl",
    "utm_medium": "smoke",
    "utm_campaign": "cors-go-live"
  }'
# Expect 200 {"ok":true}, ACAO header echoed
```

Verify in Supabase SQL editor:

```sql
select id, email, source, status, notes
from public.waitlist_signups
where email = 'smoke-test+1@alivelabs.io';

select email, industry_type, status, source
from marketing.contacts
where email = 'smoke-test+1@alivelabs.io';
```

Both should be present. `notes` should contain the JSON `{"utm":{"source":"manual-curl",...}}`.

### 5.3 Promote `app.getticket.ai` to production alias

In Vercel Dashboard → `prophet` → **Settings → Domains** → mark `app.getticket.ai` as the production alias.

Decide simultaneously what to do with the old aliases (keep, redirect, or remove). Recommended:

- **Keep `www.thevatic.com` and `thevatic.com` aliased temporarily** so any in-flight magic links / Stripe receipts with the old URL still resolve.
- After 14 days, remove from `prophet` and either set up a static 301 redirect to `app.getticket.ai` (via a tiny separate Vercel project) or fully sunset.
- **`getvatic.com` / `www.getvatic.com`** — no obvious customer dependency; safe to remove from `prophet` aliases now or in 14 days.

Update `app/docs/Stripe Production.md` and `BLUEPRINT.md` after disposition decision.

---

## 6. Bryan + Chris handoff message

> **Copy-paste from here ↓ to send to Bryan and Chris.**

---

Bryan, Chris —

The product app is moving from `https://www.thevatic.com` to `https://app.getticket.ai`. Lead capture from the marketing site is wired into the product app's `/api/waitlist` endpoint with CORS, so signups on `getticket.ai` land directly in our admin queue and Chris's n8n drip without any CRM / mailing-list middleware.

Here's what we need from you, in order. Don't start step 2 until step 1 is done.

### 1. DNS — one CNAME on `getticket.ai`

```
Type:   CNAME
Name:   app
Value:  cname.vercel-dns.com
TTL:    300
```

This points `app.getticket.ai` at our Vercel `prophet` project. The marketing site at `getticket.ai` apex + `www.getticket.ai` is unchanged.

### 2. DNS — Resend domain verification on `getticket.ai`

We need `getticket.ai` verified as a sending domain so the product app can send transactional email from `hello@getticket.ai` (replacing the legacy `info@getvatic.com`). Resend will give us 5-6 records to add — TXT for SPF, 3 CNAMEs for DKIM, optional MX, TXT for DMARC. Anand will send the exact records once Resend prints them.

### 3. Marketing form code change on `getticket.ai`

Today the form on `getticket.ai` posts somewhere that doesn't reach our app. After step 1's DNS propagates, replace the submit handler with this:

```ts
const endpoint = process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT
  ?? 'https://app.getticket.ai/api/waitlist';

async function onSubmit(form) {
  const params = new URLSearchParams(window.location.search);
  const body = {
    email: form.email,
    first_name: form.first_name,
    last_name: form.last_name,
    business_name: form.company || undefined,
    source: 'getticket.ai',
    industry_type: 'restaurant',
    utm_source: params.get('utm_source') || undefined,
    utm_medium: params.get('utm_medium') || undefined,
    utm_campaign: params.get('utm_campaign') || undefined,
    utm_term: params.get('utm_term') || undefined,
    utm_content: params.get('utm_content') || undefined,
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return showSuccess();
  if (res.status === 409) return showSuccess('You\'re already on the list.');
  if (res.status === 400) return showInvalid();
  return showRetry();
}
```

Field names are **snake_case** to match the API contract. The "Company (optional)" input maps to `business_name`. Treat `409` as success in the UI — it just means the visitor already signed up.

Set `NEXT_PUBLIC_WAITLIST_ENDPOINT=https://app.getticket.ai/api/waitlist` in the marketing-site Vercel project env so future endpoint changes are env-only.

### 4. UTM persistence on landing

For Chris's drip variants by campaign to work, capture UTMs **on landing**, not just on form submit. Easiest fix: in the marketing-site root layout, copy `utm_*` params from `window.location.search` into `sessionStorage` on first paint. Then read from `sessionStorage` in the form. This survives internal navigation before the visitor reaches the form.

### 5. Joint smoke test (15 minutes, screen-share)

Once steps 1, 2, 3, 4 are done in a `getticket.ai` preview deploy:

1. Bryan submits a test email
2. Anand confirms the row in `public.waitlist_signups` and `marketing.contacts`
3. Chris confirms the contact appears in the n8n drip queue
4. Bryan submits one final test from `getticket.ai` production
5. Anand approves from `/admin/waitlist` → magic-link invite arrives at the test address → routes the user into `app.getticket.ai`

### 6. What you do NOT need to do

- No CORS config on your end. The receiving server enforces it; we've allow-listed `https://getticket.ai` and `https://www.getticket.ai`.
- No API keys / secrets to embed in the marketing site.
- No DNS for `app.*` (we own that subdomain on Vercel after step 1).
- No changes to Chris's existing Resend / n8n config beyond confirming the drip fires off `marketing.contacts`.

### Failure modes worth knowing

If the waitlist endpoint 5xx's during a campaign spike, leads are lost. As a fallback, the form should also POST a duplicate body to a Formspree-style backup or `mailto:chris@alivelabs.io` on any non-2xx + non-409 response. Worst case: point the form at `mailto:chris@alivelabs.io` while we debug.

Open questions:
- Privacy / Terms pages on `getticket.ai` — Stripe Customer Portal links there. If they don't exist yet, the in-portal "View Privacy" link 404s. Bryan, are those pages live?
- Captcha — we should add Cloudflare Turnstile to the marketing form before going wide. Let's track as a follow-up; not blocking launch.

— Anand

---

> **End of Bryan/Chris message.**

---

## 7. Post-cutover cleanup (after stable for 7-14 days)

- [ ] Remove `https://www.thevatic.com/auth/callback` and `https://www.thevatic.com/**` from Supabase Authentication redirect allow-list
- [ ] Delete the old Google OAuth client (or at least remove the `https://www.thevatic.com` redirect URIs)
- [ ] Remove old Stripe webhook endpoint at `https://www.thevatic.com/api/stripe/webhook` (only if you created a new one in 4.3 instead of updating in place — if you updated in place, this is moot)
- [ ] Remove `www.thevatic.com`, `thevatic.com`, `www.getvatic.com`, `getvatic.com` from `prophet` Vercel domain aliases
- [ ] Decide final disposition of `thevatic.com` domain (sunset, redirect to `app.getticket.ai`, or repurpose as Alive Labs platform page)
- [ ] Bump TTL on the `app` CNAME from 300 to 3600 once stable
- [ ] If you set `RESEND_FROM_TICKET` during the transition (4.1 / 4.5), remove it from Vercel env once Resend `getticket.ai` verification is confirmed
- [ ] Delete the superseded plan file `.cursor/plans/getticket-waitlist-cors_a6f0252f.plan.md` (CORS-only plan now subsumed)
- [ ] Re-link `.vercel/project.json` to the Alive Labs team (`vercel link --project prophet --scope alive-labs`) and commit the corrected file

---

## Reference: every callsite that depends on `NEXT_PUBLIC_APP_URL`

If you ever wonder whether a code path is on the new URL, this is the full list (verified 2026-04-29):

- `app/(auth)/login/actions.ts` — magic link + Google OAuth `redirectTo`
- `app/api/stripe/checkout/route.ts` — Checkout `success_url`/`cancel_url`
- `app/api/stripe/portal/route.ts` — Customer Portal `return_url`
- `app/api/stripe/webhook/route.ts` — `portalUrl` in payment-failed email
- `app/api/cron/daily/route.ts` — internal self-fetch base URL (post-bug-fix)
- `app/api/cron/trial-reminders/route.ts` — billing links in trial reminders
- `app/api/waitlist/route.ts` — admin notification dashboard URL
- `app/onboarding/actions.ts` — welcome email `dashboardUrl`
- `app/(dashboard)/competitors/actions.ts` — server-side fetch to `/api/places/details`
- `app/actions/user-management.ts` (3 callsites) — admin invite + magic link
- `app/actions/waitlist.ts` (2 callsites) — waitlist approve/resend magic link
- `app/actions/admin-management.ts` — platform admin invite
- `lib/email/templates/layout.tsx` — email logo / link base URL

If any of these stops working post-cutover, bet on `NEXT_PUBLIC_APP_URL` being stale or unset before debugging the callsite itself.
