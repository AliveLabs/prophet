/* eslint-disable no-console */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import { createClient } from "@supabase/supabase-js"
import path from "node:path"
import fs from "node:fs"

loadEnv({ path: ".env.local" })

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY!

const TEST_USER_ID = "7014cc05-b8b1-4a94-bf06-2e7de472837f"
const TEST_USER_EMAIL = "anand@alivemethod.com"
const TEST_ORG_ID = "d379df59-11a1-4efb-ad6d-b92be4011ca7"
const TEST_CUSTOMER_ID = "cus_UOzyxZIdEw1sW9"

const SCREENSHOT_DIR = path.resolve("scripts/stripe/.e2e-screenshots")
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type StepResult = {
  test: string
  status: "PASS" | "FAIL" | "SKIP"
  details: string[]
  error?: string
  screenshots: string[]
}

const results: StepResult[] = []

function log(...args: unknown[]) {
  console.log("[e2e]", ...args)
}

async function shot(page: Page, name: string): Promise<string> {
  const fullPath = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: fullPath, fullPage: true })
  return path.relative(process.cwd(), fullPath)
}

async function generateMagicLinkSession(): Promise<string> {
  log(`Generating magic link for ${TEST_USER_EMAIL}…`)
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_USER_EMAIL,
    options: { redirectTo: `${APP_URL}/auth/callback` },
  })
  if (error || !data?.properties?.action_link) {
    throw new Error(`generateLink failed: ${error?.message ?? "no action_link"}`)
  }
  log(`  action_link host: ${new URL(data.properties.action_link).host}`)
  return data.properties.action_link
}

async function readOrg() {
  const { data, error } = await admin
    .from("organizations")
    .select(
      "subscription_tier,payment_state,stripe_customer_id,stripe_subscription_id,stripe_price_id,current_period_end,cancel_at_period_end,trial_ends_at"
    )
    .eq("id", TEST_ORG_ID)
    .single()
  if (error) throw error
  return data
}

async function loginThroughBrowser(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`  [browser console error] ${msg.text()}`)
  })
  const link = await generateMagicLinkSession()
  log("Navigating magic link → Supabase verify → /auth/callback…")
  await page.goto(link, { waitUntil: "domcontentloaded" })
  // Magic link redirects through Supabase verify, then to /auth/callback?code=...,
  // which exchanges + sets cookies, then redirects to /home or /onboarding.
  await page.waitForURL(/localhost:3000\/(home|onboarding)/, { timeout: 30_000 })
  log(`  landed on: ${page.url()}`)
  return page
}

async function gotoBilling(page: Page): Promise<void> {
  log("Navigating to /settings/billing…")
  await page.goto(`${APP_URL}/settings/billing`, { waitUntil: "networkidle" })
  log(`  landed on: ${page.url()}`)
}

async function fillStripeCheckoutCard(
  page: Page,
  cardNumber: string,
  name: string
): Promise<void> {
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(3500)
  // Stripe Checkout shows Card / Klarna / Cash App / Bank radios. Click Card.
  const cardRadio = page.getByRole("radio", { name: /^Card$/ })
  if (await cardRadio.count()) {
    log("  Selecting 'Card' payment method…")
    await cardRadio.first().click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(1000)
  } else {
    // Fallback: click the row by accessible row text
    const row = page.locator('div[role="radio"]:has-text("Card")').first()
    if (await row.count()) {
      log("  Selecting 'Card' (role=radio fallback)…")
      await row.click({ force: true }).catch(() => undefined)
      await page.waitForTimeout(1000)
    }
  }
  log("  Filling card fields…")
  await page.locator('input[name="cardNumber"]').waitFor({ state: "visible", timeout: 20_000 })
  await page.locator('input[name="cardNumber"]').fill(cardNumber)
  await page.locator('input[name="cardExpiry"]').fill("12 / 34")
  await page.locator('input[name="cardCvc"]').fill("123")
  const nameField = page.locator('input[name="billingName"]')
  if (await nameField.count()) await nameField.first().fill(name)
  const zip = page.locator('input[name="billingPostalCode"]')
  if (await zip.count()) await zip.first().fill("30303")

  // Uncheck "Save my information for faster checkout" (Link enrollment) — it
  // forces a phone number which blocks our test submit.
  const linkOptIn = page.getByRole("checkbox", { name: /Save my information for faster checkout/i })
  if (await linkOptIn.count()) {
    const checked = await linkOptIn.first().isChecked().catch(() => false)
    if (checked) {
      log("  Unchecking Link 'Save my info'…")
      await linkOptIn.first().click({ force: true }).catch(() => undefined)
      await page.waitForTimeout(400)
    }
  }
}

async function ensureFreeOrgState() {
  await admin
    .from("organizations")
    .update({
      subscription_tier: "free",
      payment_state: null,
      stripe_subscription_id: null,
      stripe_price_id: null,
      cancel_at_period_end: false,
      current_period_end: null,
      trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    })
    .eq("id", TEST_ORG_ID)
}

async function cancelExistingSub() {
  const org = await readOrg()
  if (!org.stripe_subscription_id) return
  const r = await fetch(
    `https://api.stripe.com/v1/subscriptions/${org.stripe_subscription_id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Basic ${Buffer.from(STRIPE_SECRET + ":").toString("base64")}` },
    }
  )
  log(`  canceled sub ${org.stripe_subscription_id} → status=${r.status}`)
  await new Promise((r) => setTimeout(r, 3000))
}

// ---------------------------------------------------------------------------
// T15 — Real checkout (Ticket Entry monthly) using 4242 4242 4242 4242
// ---------------------------------------------------------------------------
async function runT15(page: Page): Promise<StepResult> {
  const test = "T15: Real Stripe Checkout (Ticket Entry monthly, success)"
  const screenshots: string[] = []
  const details: string[] = []
  log(`▶ ${test}`)
  try {
    await ensureFreeOrgState()
    await gotoBilling(page)
    screenshots.push(await shot(page, "t15-01-billing-page"))

    log("Clicking Table (Entry monthly)…")
    const entryButton = page.locator('button:has-text("Table")').first()
    await entryButton.waitFor({ state: "visible", timeout: 10_000 })
    await entryButton.click()

    log("Waiting for redirect to Stripe Checkout…")
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 })
    details.push(`Stripe Checkout URL: ${new URL(page.url()).origin}${new URL(page.url()).pathname.slice(0, 30)}…`)
    screenshots.push(await shot(page, "t15-02-stripe-checkout-loaded"))

    await fillStripeCheckoutCard(page, "4242424242424242", "STRIPE-TEST Owner")
    screenshots.push(await shot(page, "t15-03-card-filled"))

    log("Submitting Stripe Checkout (Subscribe)…")
    const submit = page.locator(
      'button[type="submit"]:has-text("Subscribe"), button[type="submit"]:has-text("Start trial"), button[type="submit"]:has-text("Pay")'
    ).first()
    await submit.click()

    log("Waiting for redirect back to /settings/billing?upgraded=true…")
    await page.waitForURL(/\/settings\/billing\?upgraded=true/, { timeout: 60_000 })
    screenshots.push(await shot(page, "t15-04-back-on-billing"))

    log("Allowing webhook to land before reading DB (5s)…")
    await page.waitForTimeout(5000)

    const org = await readOrg()
    details.push(`org.subscription_tier=${org.subscription_tier}`)
    details.push(`org.payment_state=${org.payment_state}`)
    details.push(`org.stripe_subscription_id=${org.stripe_subscription_id}`)
    details.push(`org.stripe_price_id=${org.stripe_price_id}`)
    details.push(
      `expected price (Ticket Entry monthly)=${process.env.STRIPE_PRICE_ID_TICKET_ENTRY_MONTHLY}`
    )

    if (
      org.subscription_tier !== "entry" ||
      org.payment_state !== "active" ||
      org.stripe_price_id !== process.env.STRIPE_PRICE_ID_TICKET_ENTRY_MONTHLY ||
      !org.stripe_subscription_id
    ) {
      throw new Error(
        `Expected (entry, active, TICKET_ENTRY_MONTHLY price, sub_id set), got (${org.subscription_tier}, ${org.payment_state}, ${org.stripe_price_id}, ${org.stripe_subscription_id})`
      )
    }

    return { test, status: "PASS", details, screenshots }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    try {
      screenshots.push(await shot(page, "t15-FAIL"))
    } catch {}
    return { test, status: "FAIL", details, error, screenshots }
  }
}

// ---------------------------------------------------------------------------
// T16 — Customer Portal: switch to House (Top) annual
// ---------------------------------------------------------------------------
async function runT16(page: Page): Promise<StepResult> {
  const test = "T16: Customer Portal (switch Entry monthly → House annual)"
  const screenshots: string[] = []
  const details: string[] = []
  log(`▶ ${test}`)
  try {
    const orgPre = await readOrg()
    if (!orgPre.stripe_subscription_id) {
      details.push("(skip) no active subscription on test org — T15 likely failed")
      return { test, status: "SKIP", details, screenshots }
    }
    await gotoBilling(page)
    screenshots.push(await shot(page, "t16-01-billing-after-checkout"))

    log("Clicking Manage billing…")
    const portalBtn = page.locator(
      'button:has-text("Manage billing"), a:has-text("Manage billing"), button:has-text("Manage subscription"), a:has-text("Manage subscription")'
    ).first()
    await portalBtn.waitFor({ state: "visible", timeout: 15_000 })
    // App opens portal in new tab via window.open or POSTs and redirects via JS.
    const popupPromise = page.context().waitForEvent("page", { timeout: 5_000 }).catch(() => null)
    await portalBtn.click()
    const popup = await popupPromise
    if (popup) {
      log("  Portal opened in new tab — switching focus.")
      await popup.waitForLoadState("domcontentloaded")
      // Re-bind `page` for the rest of T16 by reassigning local var.
      page = popup
    }

    log("Waiting for billing.stripe.com (portal)…")
    await page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 })
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2500)
    screenshots.push(await shot(page, "t16-02-portal-home"))

    log("Click 'Update plan' / 'Update subscription'…")
    const updateBtn = page.locator(
      'a:has-text("Update plan"), a:has-text("Update subscription"), button:has-text("Update plan"), button:has-text("Update subscription")'
    ).first()
    await updateBtn.waitFor({ state: "visible", timeout: 15_000 })
    await updateBtn.click()
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)
    screenshots.push(await shot(page, "t16-03-portal-plans"))

    log("Switching billing cadence to Yearly…")
    const yearlyToggle = page.locator(':text("Yearly")').first()
    if (await yearlyToggle.count()) {
      await yearlyToggle.click({ force: true }).catch(() => undefined)
      await page.waitForTimeout(800)
    }

    log("Selecting House (Top) tier — clicking its Select control…")
    const selectControls = page.getByRole("button", { name: /^Select$/ })
    const selCount = await selectControls.count()
    log(`  Found ${selCount} 'Select' controls (role=button); clicking last (House).`)
    if (selCount > 0) {
      await selectControls.nth(selCount - 1).click()
    }
    await page.waitForTimeout(800)
    screenshots.push(await shot(page, "t16-04-portal-house-selected"))

    log("Clicking Continue…")
    const continueBtn = page.getByRole("button", { name: /^Continue$/ }).first()
    await continueBtn.waitFor({ state: "visible", timeout: 15_000 })
    await continueBtn.click()
    await page.waitForTimeout(2000)
    screenshots.push(await shot(page, "t16-05-portal-confirm"))

    log("Clicking Confirm…")
    const confirmBtn = page.getByRole("button", { name: /Confirm/i }).first()
    await confirmBtn.waitFor({ state: "visible", timeout: 15_000 })
    await confirmBtn.click()

    log("Returning to app…")
    await page.waitForTimeout(3000)
    const back = page.locator('a:has-text("Return to"), a[href*="/settings/billing"]').first()
    if (await back.count()) {
      await back.click().catch(() => undefined)
    }
    await page.waitForURL(/localhost:3000\/settings\/billing/, { timeout: 20_000 }).catch(() => undefined)

    log("Allowing webhook (5s)…")
    await page.waitForTimeout(5000)
    screenshots.push(await shot(page, "t16-06-back-in-app"))

    const org = await readOrg()
    details.push(`org.subscription_tier=${org.subscription_tier}`)
    details.push(`org.payment_state=${org.payment_state}`)
    details.push(`org.stripe_price_id=${org.stripe_price_id}`)
    details.push(
      `expected (Ticket Top annual)=${process.env.STRIPE_PRICE_ID_TICKET_TOP_ANNUAL}`
    )

    if (
      org.subscription_tier !== "top" ||
      org.stripe_price_id !== process.env.STRIPE_PRICE_ID_TICKET_TOP_ANNUAL
    ) {
      throw new Error(
        `Expected (top, TICKET_TOP_ANNUAL), got (${org.subscription_tier}, ${org.stripe_price_id})`
      )
    }
    return { test, status: "PASS", details, screenshots }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    try {
      screenshots.push(await shot(page, "t16-FAIL"))
    } catch {}
    return { test, status: "FAIL", details, error, screenshots }
  }
}

// ---------------------------------------------------------------------------
// T17 — Card decline flow (4000 0000 0000 9995)
// ---------------------------------------------------------------------------
async function runT17(page: Page): Promise<StepResult> {
  const test = "T17: Card decline (4000 0000 0000 9995) on Stripe Checkout"
  const screenshots: string[] = []
  const details: string[] = []
  log(`▶ ${test}`)
  try {
    log("Cancelling any current sub + resetting org…")
    await cancelExistingSub()
    await ensureFreeOrgState()

    await gotoBilling(page)
    screenshots.push(await shot(page, "t17-01-billing-reset"))

    const entryButton = page.locator('button:has-text("Table")').first()
    await entryButton.waitFor({ state: "visible", timeout: 10_000 })
    await entryButton.click()
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 })

    await fillStripeCheckoutCard(page, "4000000000009995", "STRIPE-TEST Decline")
    screenshots.push(await shot(page, "t17-02-decline-card-filled"))

    log("Submitting (expecting decline)…")
    const submit = page.locator('button[type="submit"]:has-text("Subscribe"), button[type="submit"]:has-text("Start trial"), button[type="submit"]:has-text("Pay")').first()
    await submit.click()

    log("Waiting for inline decline error…")
    const errorEl = page.locator('text=/declined|insufficient|card was declined|try a different/i').first()
    await errorEl.waitFor({ state: "visible", timeout: 30_000 })
    const errorText = (await errorEl.textContent()) ?? "(no text)"
    details.push(`Stripe error message: ${errorText.trim()}`)
    screenshots.push(await shot(page, "t17-03-declined"))

    // Verify org row didn't change (still free).
    const org = await readOrg()
    details.push(`org.subscription_tier=${org.subscription_tier}`)
    details.push(`org.payment_state=${org.payment_state}`)
    if (org.subscription_tier !== "free") {
      throw new Error(`Expected free tier after decline, got ${org.subscription_tier}`)
    }

    return { test, status: "PASS", details, screenshots }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    try {
      screenshots.push(await shot(page, "t17-FAIL"))
    } catch {}
    return { test, status: "FAIL", details, error, screenshots }
  }
}

// ---------------------------------------------------------------------------
// T18 — Trial expired gate
// ---------------------------------------------------------------------------
async function runT18(page: Page): Promise<StepResult> {
  const test = "T18: TrialExpiredGate renders when trial ends with no active sub"
  const screenshots: string[] = []
  const details: string[] = []
  log(`▶ ${test}`)
  try {
    log("Setting org to free + trial_ends_at in the past…")
    await admin
      .from("organizations")
      .update({
        subscription_tier: "free",
        payment_state: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        cancel_at_period_end: false,
        trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      })
      .eq("id", TEST_ORG_ID)

    log("Navigating to /home…")
    await page.goto(`${APP_URL}/home`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1500)
    screenshots.push(await shot(page, "t18-01-home-after-cancel"))

    // The TrialExpiredGate has a distinctive heading. Use loose text match.
    const gateHeading = page.locator(
      'text=/your trial has ended|trial ended|subscribe|reactivate|choose your plan/i'
    ).first()
    await gateHeading.waitFor({ state: "visible", timeout: 15_000 })
    const headingText = (await gateHeading.textContent()) ?? "(no text)"
    details.push(`Detected gate heading: "${headingText.trim().slice(0, 80)}"`)

    // Also confirm the three tier names are present.
    const hasTable = (await page.locator('text=Table').count()) > 0
    const hasShift = (await page.locator('text=Shift').count()) > 0
    const hasHouse = (await page.locator('text=House').count()) > 0
    details.push(`Tier cards visible: Table=${hasTable}, Shift=${hasShift}, House=${hasHouse}`)
    if (!hasTable || !hasShift || !hasHouse) {
      throw new Error("Expected all three Ticket tier cards (Table/Shift/House) in gate.")
    }
    screenshots.push(await shot(page, "t18-02-gate-rendered"))

    return { test, status: "PASS", details, screenshots }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    try {
      screenshots.push(await shot(page, "t18-FAIL"))
    } catch {}
    return { test, status: "FAIL", details, error, screenshots }
  }
}

// ---------------------------------------------------------------------------
async function main() {
  log(`APP_URL=${APP_URL}`)
  log(`Test org=${TEST_ORG_ID}, customer=${TEST_CUSTOMER_ID}`)
  log(`Stripe mode=${STRIPE_SECRET.startsWith("sk_test_") ? "TEST" : "LIVE"}`)
  if (!STRIPE_SECRET.startsWith("sk_test_")) {
    throw new Error("Refusing to run E2E against LIVE Stripe key.")
  }

  const browser: Browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  })
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: 1280, height: 900 },
  })

  let page: Page | null = null
  try {
    page = await loginThroughBrowser(context)
    results.push(await runT15(page))
    results.push(await runT16(page))
    results.push(await runT17(page))
    results.push(await runT18(page))
  } finally {
    await context.close()
    await browser.close()
  }

  console.log("\n" + "=".repeat(72))
  console.log("E2E SUMMARY")
  console.log("=".repeat(72))
  for (const r of results) {
    console.log(`\n${r.status === "PASS" ? "✓" : "✗"} ${r.test} — ${r.status}`)
    for (const d of r.details) console.log(`    ${d}`)
    if (r.error) console.log(`    error: ${r.error}`)
    for (const s of r.screenshots) console.log(`    [shot] ${s}`)
  }
  const failed = results.filter((r) => r.status === "FAIL")
  console.log("\n" + "=".repeat(72))
  console.log(`${results.length - failed.length}/${results.length} passed`)
  console.log("=".repeat(72))

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, "results.json"),
    JSON.stringify(results, null, 2)
  )

  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("[e2e] fatal:", err)
  process.exit(1)
})
