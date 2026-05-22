import { expect, test } from "@playwright/test";

test("application serves the login route", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("body")).toBeVisible();
});
