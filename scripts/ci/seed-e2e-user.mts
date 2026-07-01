// CI-ONLY seed script for the Playwright route-smoke suite (ALT-244).
//
// Creates (idempotently) a dedicated, non-billable test org + owner user + platform_admins
// row against a CI-only Supabase project, so the e2e suite can exercise the REAL auth path
// (magic-link → session) instead of any code-level bypass baked into the app.
//
// SAFETY:
//   - Reads CI_SUPABASE_URL / CI_SUPABASE_SERVICE_ROLE_KEY — env vars that are only ever
//     configured as GitHub Actions repo/environment secrets pointed at a dedicated CI/test
//     Supabase project. They are never set in prod env config and nothing in the shipped app
//     reads them, so there's no way for prod to accidentally exercise this path.
//   - Refuses to run unless CI_SUPABASE_URL is set AND does not look like the prod project
//     (belt-and-suspenders — see assertNotProd below).
//   - org_kind is always "test" (reuses the same admin-panel "non-billable" org classification
//     as app/admin/sandbox, so this test org is bulk-clearable and never appears in real metrics).
//
// Usage: npx tsx scripts/ci/seed-e2e-user.mts
// Writes the minted session + ids to $E2E_SEED_OUTPUT (JSON) for the Playwright global-setup to
// consume, default /tmp/e2e-seed.json.

import { writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "../../types/database.types"
import { createOrgWithOwner } from "../../lib/admin/org-factory"

const PROD_PROJECT_REF = "triodvdspdsuudooyura" // see ticket-prod-domain memory — never seed here

function assertNotProd(url: string) {
  if (url.includes(PROD_PROJECT_REF)) {
    throw new Error(
      "[seed-e2e-user] CI_SUPABASE_URL points at the PRODUCTION Supabase project. Refusing to run."
    )
  }
}

async function main() {
  const url = process.env.CI_SUPABASE_URL
  const serviceKey = process.env.CI_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      "[seed-e2e-user] CI_SUPABASE_URL and CI_SUPABASE_SERVICE_ROLE_KEY are required (CI-only secrets; see .github/workflows/ci.yml)."
    )
  }
  assertNotProd(url)

  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false } })

  const email = process.env.E2E_TEST_EMAIL ?? "e2e-route-smoke@ci.getticket.ai"

  // Idempotent user lookup/create — reruns (retries, re-triggered CI) must not pile up users.
  let userId: string
  const { data: existing } = await admin.auth.admin.listUsers()
  const found = existing?.users.find((u) => u.email === email)
  if (found) {
    userId = found.id
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { e2e_seed: true },
    })
    if (error || !created.user) throw new Error(`[seed-e2e-user] createUser failed: ${error?.message}`)
    userId = created.user.id
  }

  // Idempotent org lookup/create.
  const orgName = "E2E Route Smoke"
  const { data: existingOrg } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "e2e-route-smoke")
    .maybeSingle()

  let orgId: string
  if (existingOrg) {
    orgId = existingOrg.id
  } else {
    const result = await createOrgWithOwner(admin, {
      ownerUserId: userId,
      orgName,
      orgKind: "test",
      industryType: "restaurant",
      trialDays: 365,
    })
    orgId = result.orgId
  }

  // Grant platform-admin so the same seeded user can also exercise /admin/* routes.
  const { data: existingAdmin } = await admin
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()
  if (!existingAdmin) {
    const { error } = await admin
      .from("platform_admins")
      .insert({ user_id: userId, email, role: "super_admin" })
    if (error) throw new Error(`[seed-e2e-user] platform_admins insert failed: ${error.message}`)
  }

  // Mint a real session via the actual magic-link path (exercises real auth, not a bypass).
  // action_link points at Supabase's own GoTrue /verify endpoint; on success GoTrue redirects
  // to redirectTo?code=... which is EXACTLY what app/auth/callback/route.ts already handles
  // (exchangeCodeForSession) for real users clicking a real magic-link email. Playwright's
  // global-setup just needs to navigate the browser to action_link once.
  const appUrl = process.env.E2E_APP_URL ?? "http://127.0.0.1:3000"
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })
  if (linkError || !linkData) {
    throw new Error(`[seed-e2e-user] generateLink failed: ${linkError?.message}`)
  }

  const out = {
    url,
    userId,
    orgId,
    email,
    actionLink: linkData.properties.action_link,
  }

  const outputPath = process.env.E2E_SEED_OUTPUT ?? "/tmp/e2e-seed.json"
  writeFileSync(outputPath, JSON.stringify(out, null, 2))
  console.log(`[seed-e2e-user] seeded user=${userId} org=${orgId} -> ${outputPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
