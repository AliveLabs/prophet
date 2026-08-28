import { test, expect } from "@playwright/test"

test.describe("auth + onboarding smoke", () => {
  test("login, signup, onboarding entry points", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "Sign in to your feed." })).toBeVisible()
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible()

    await page.goto("/signup")
    await expect(page.getByRole("heading", { name: "Create your account." })).toBeVisible()
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible()

    await page.goto("/onboarding")
    await expect(page).toHaveURL(/\/login/)
  })
})
