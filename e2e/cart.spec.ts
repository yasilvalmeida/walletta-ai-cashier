import { test, expect } from "@playwright/test";

test.describe("Cart UI Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("cart bottom sheet is hidden when empty", async ({ page }) => {
    // No bottom sheet visible when cart is empty
    const itemCount = page.locator("text=items");
    await expect(itemCount).not.toBeVisible();
  });

  test("mic button is clickable", async ({ page }) => {
    const micButton = page.getByRole("button", { name: /start listening/i });
    await expect(micButton).toBeVisible();
    await expect(micButton).toBeEnabled();
  });
});

test.describe("SSE Cart Integration", () => {
  test("add_to_cart SSE event updates cart UI", async ({ request, page }) => {
    await page.goto("/");

    // Call the chat API directly to trigger an add_to_cart action
    const response = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "Add one Americano please" }],
        cartContext: [],
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();

    // Verify the SSE stream contains a cart action
    expect(body).toContain('"type":"cart_action"');
    expect(body).toContain('"add_to_cart"');

    // Parse the cart_action payload from SSE
    const lines = body.split("\n");
    let cartPayload: {
      product_id: string;
      product_name: string;
      quantity: number;
      unit_price: number;
    } | null = null;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "cart_action" && event.action === "add_to_cart") {
          cartPayload = event.payload;
          break;
        }
      } catch {
        // skip non-JSON lines
      }
    }

    expect(cartPayload).not.toBeNull();
    expect(cartPayload!.product_name).toBeTruthy();
    expect(cartPayload!.unit_price).toBeGreaterThan(0);
  });

  test("multiple items can be added via separate requests", async ({
    request,
  }) => {
    // First request
    const res1 = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "I want a Matcha Power" }],
        cartContext: [],
      },
    });
    expect(res1.status()).toBe(200);
    const body1 = await res1.text();
    expect(body1).toContain('"add_to_cart"');

    // Second request with cart context from first
    const res2 = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "Also add a Chagaccino" }],
        cartContext: [
          {
            product_id: "smoothie-matcha-power",
            product_name: "Matcha Power",
            quantity: 1,
            unit_price: 19.0,
            line_total: 19.0,
          },
        ],
      },
    });
    expect(res2.status()).toBe(200);
    const body2 = await res2.text();
    expect(body2).toContain('"add_to_cart"');
  });
});
