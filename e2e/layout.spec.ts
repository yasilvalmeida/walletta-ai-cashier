import { test, expect } from "@playwright/test";

test.describe("Layout & Design", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads with correct title", async ({ page }) => {
    await expect(page).toHaveTitle("Walletta AI Cashier — Erewhon Market");
  });

  test("full-screen portrait layout renders", async ({ page }) => {
    // Avatar background fills the viewport
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // Mic button is visible
    const micButton = page.getByRole("button", { name: /start listening/i });
    await expect(micButton).toBeVisible();
  });

  test("standby overlay shows on avatar panel", async ({ page }) => {
    const standby = page.locator("text=Standby");
    await expect(standby).toBeVisible();
  });

  test("mic prompt is visible in idle state", async ({ page }) => {
    const prompt = page.locator("text=Tap to start ordering");
    await expect(prompt).toBeVisible();
  });

  test("no horizontal scroll on page", async ({ page }) => {
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("no vertical scroll on page", async ({ page }) => {
    const scrollHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    const clientHeight = await page.evaluate(
      () => document.documentElement.clientHeight
    );
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  });

  test("bottom sheet is hidden when cart is empty", async ({ page }) => {
    // No bottom sheet visible when cart is empty
    const bottomSheet = page.locator("text=items");
    await expect(bottomSheet).not.toBeVisible();
  });
});

test.describe("iPad Pro Landscape (1366x1024)", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("layout fills viewport without overflow", async ({ page }) => {
    await page.goto("/");

    const overflow = await page.evaluate(() => {
      const body = document.body;
      return {
        overflowX: body.scrollWidth > body.clientWidth,
        overflowY: body.scrollHeight > body.clientHeight,
      };
    });

    expect(overflow.overflowX).toBe(false);
    expect(overflow.overflowY).toBe(false);
  });
});
