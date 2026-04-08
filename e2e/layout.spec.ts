import { test, expect } from "@playwright/test";

test.describe("Layout & Design", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads with correct title", async ({ page }) => {
    await expect(page).toHaveTitle("Walletta AI Cashier — Erewhon Market");
  });

  test("split-screen layout renders — 45% POS / 55% Avatar", async ({
    page,
  }) => {
    const posPanel = page.locator("text=Erewhon Market").first();
    await expect(posPanel).toBeVisible();

    const micButton = page.getByRole("button", { name: /start listening/i });
    await expect(micButton).toBeVisible();
  });

  test("Erewhon Market header is visible", async ({ page }) => {
    const header = page.locator("h1", { hasText: "Erewhon Market" });
    await expect(header).toBeVisible();
  });

  test("AI-Powered Checkout subtitle is visible", async ({ page }) => {
    const subtitle = page.locator("text=AI-Powered Checkout");
    await expect(subtitle).toBeVisible();
  });

  test("empty cart message shows", async ({ page }) => {
    const emptyMsg = page.locator("text=Your cart is empty");
    await expect(emptyMsg).toBeVisible();
  });

  test("standby overlay shows on avatar panel", async ({ page }) => {
    const standby = page.locator("text=Standby");
    await expect(standby).toBeVisible();
  });

  test("mic prompt is visible in idle state", async ({ page }) => {
    const prompt = page.locator("text=Tap the mic to start ordering");
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
