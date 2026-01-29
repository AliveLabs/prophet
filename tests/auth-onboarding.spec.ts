import { test, expect } from "@playwright/test"

test.describe("auth + onboarding smoke", () => {
  test("login, signup, onboarding entry points", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible()
    await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible()

    await page.goto("/signup")
    await expect(
      page.getByRole("heading", { name: "Start monitoring in minutes." })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible()

    await page.goto("/onboarding")
    await expect(page).toHaveURL(/\/login/)
  })
})
