import { test, expect } from "@playwright/test";

test.describe("API Routes", () => {
  test("POST /api/chat returns SSE stream with valid response", async ({
    request,
  }) => {
    const response = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "What smoothies do you have?" }],
        cartContext: [],
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain('data: {"type":');
    expect(body).toContain('"type":"done"');
  });

  test("POST /api/chat — add_to_cart triggers cart_action event", async ({
    request,
  }) => {
    const response = await request.post("/api/chat", {
      data: {
        messages: [
          { role: "user", content: "Add one Americano to my cart please" },
        ],
        cartContext: [],
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"cart_action"');
    expect(body).toContain('"action":"add_to_cart"');
    expect(body).toContain("americano");
  });

  test("POST /api/chat — remove_from_cart works", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "Remove the Americano" }],
        cartContext: [
          {
            product_id: "coffee-americano",
            product_name: "Americano",
            quantity: 1,
            unit_price: 5.0,
            line_total: 5.0,
          },
        ],
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"cart_action"');
    expect(body).toContain('"remove_from_cart"');
  });

  test("POST /api/chat — rejects invalid request body", async ({
    request,
  }) => {
    const response = await request.post("/api/chat", {
      data: { invalid: true },
    });

    expect(response.status()).toBe(500);
  });

  test("POST /api/livekit/token — generates JWT", async ({ request }) => {
    const response = await request.post("/api/livekit/token", {
      data: {
        roomName: "test-room",
        participantName: "test-user",
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.token).toBeTruthy();
    expect(data.url).toContain("wss://");
  });

  test("POST /api/livekit/token — rejects missing params", async ({
    request,
  }) => {
    const response = await request.post("/api/livekit/token", {
      data: { roomName: "test" },
    });

    expect(response.status()).toBe(400);
  });

  test("POST /api/deepgram/token — returns key", async ({ request }) => {
    const response = await request.post("/api/deepgram/token");

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.key).toBeTruthy();
  });
});
