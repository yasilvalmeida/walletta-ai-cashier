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

  test("POST /api/tts — returns WAV audio for valid text", async ({
    request,
  }) => {
    const response = await request.post("/api/tts", {
      data: { text: "Hello, welcome to Erewhon." },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("audio/wav");

    const body = await response.body();
    expect(body.length).toBeGreaterThan(44); // WAV header is 44 bytes minimum

    // Verify WAV header magic bytes: "RIFF" at offset 0, "WAVE" at offset 8
    const riff = String.fromCharCode(body[0], body[1], body[2], body[3]);
    const wave = String.fromCharCode(body[8], body[9], body[10], body[11]);
    expect(riff).toBe("RIFF");
    expect(wave).toBe("WAVE");
  });

  test("POST /api/tts — rejects empty text", async ({ request }) => {
    const response = await request.post("/api/tts", {
      data: { text: "" },
    });

    expect(response.status()).toBe(400);
  });

  test("POST /api/tts — rejects missing text field", async ({ request }) => {
    const response = await request.post("/api/tts", {
      data: {},
    });

    expect(response.status()).toBe(400);
  });

  test("Full pipeline: /api/chat text → /api/tts produces audio", async ({
    request,
  }) => {
    // Step 1: Get LLM response text
    const chatResponse = await request.post("/api/chat", {
      data: {
        messages: [{ role: "user", content: "Hello" }],
        cartContext: [],
      },
    });

    expect(chatResponse.status()).toBe(200);
    const sseBody = await chatResponse.text();

    // Extract text deltas from SSE stream
    let llmText = "";
    for (const line of sseBody.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "text") {
          llmText += event.delta;
        }
      } catch {
        // skip non-JSON
      }
    }

    expect(llmText.length).toBeGreaterThan(0);

    // Step 2: Send LLM text to TTS
    const ttsResponse = await request.post("/api/tts", {
      data: { text: llmText },
    });

    expect(ttsResponse.status()).toBe(200);
    expect(ttsResponse.headers()["content-type"]).toContain("audio/wav");

    const audioBytes = await ttsResponse.body();
    expect(audioBytes.length).toBeGreaterThan(1000); // Real audio is much larger than just a header
  });
});
