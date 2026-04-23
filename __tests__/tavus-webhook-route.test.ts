import { describe, it, expect, vi, beforeEach } from "vitest";

const publishMock = vi.fn();
vi.mock("@/lib/tavusEvents", () => ({
  publishEvent: (...args: unknown[]) => publishMock(...args),
}));

// We use a small in-memory catalog fixture so "latte" / "americano"
// resolve without pulling in the real data/products.json.
vi.mock("@/lib/catalog", () => ({
  getAllProducts: () => [
    {
      id: "prod-latte",
      name: "Oat Milk Latte",
      display_name: "Oat Milk Latte",
      price: 5.5,
      search_keywords: ["latte", "oat latte"],
      sizes: [
        { label: "12oz", price_delta: 0 },
        { label: "16oz", price_delta: 1 },
      ],
      customizations: [{ label: "Extra Shot", price: 0.75 }],
    },
    {
      id: "prod-americano",
      name: "Americano",
      display_name: "Americano",
      price: 4.0,
      search_keywords: [],
      sizes: [],
      customizations: [],
    },
  ],
}));

import { POST } from "@/app/api/tavus/webhook/route";

function makeRequest(body: unknown, raw?: string): Request {
  return new Request("http://localhost/api/tavus/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  publishMock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("/api/tavus/webhook", () => {
  it("returns 400 on malformed JSON", async () => {
    const res = await POST(makeRequest({}, "not json"));
    expect(res.status).toBe(400);
  });

  it("no-ops (but 200s) when conversation_id is missing", async () => {
    const res = await POST(makeRequest({ event_type: "x" }));
    expect(res.status).toBe(200);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("publishes a finalize event for finalize_order tool_call", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.tool_call",
        conversation_id: "c1",
        properties: { tool_name: "finalize_order" },
      })
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "finalize", conversationId: "c1" })
    );
  });

  it("resolves an add_to_cart tool_call to a cart_action event", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.tool_call",
        conversation_id: "c1",
        properties: {
          tool_name: "add_to_cart",
          arguments: {
            product_name: "Oat Milk Latte",
            quantity: 2,
            size: "16oz",
            modifiers: ["Extra Shot"],
          },
        },
      })
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cart_action",
        action: "add",
        payload: expect.objectContaining({
          product_id: "prod-latte",
          quantity: 2,
          // 5.50 base + 1.00 for 16oz = 6.50 unit
          unit_price: 6.5,
          size: "16oz",
          modifiers: [{ label: "Extra Shot", price: 0.75 }],
        }),
      })
    );
  });

  it("accepts the alternative toolcall event_type spelling", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.toolcall",
        conversation_id: "c1",
        properties: {
          name: "add_to_cart",
          args: JSON.stringify({ product_name: "Americano", quantity: 1 }),
        },
      })
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cart_action",
        payload: expect.objectContaining({ product_id: "prod-americano" }),
      })
    );
  });

  it("silently skips add_to_cart when the product cannot be resolved", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.tool_call",
        conversation_id: "c1",
        properties: {
          tool_name: "add_to_cart",
          arguments: { product_name: "Dragonfruit Soda", quantity: 1 },
        },
      })
    );
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("resolves remove_from_cart to a remove action", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.tool_call",
        conversation_id: "c1",
        properties: {
          tool_name: "remove_from_cart",
          arguments: { product_name: "Americano" },
        },
      })
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cart_action",
        action: "remove",
        payload: expect.objectContaining({ product_id: "prod-americano" }),
      })
    );
  });

  it("publishes a transcript event for conversation.utterance", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.utterance",
        conversation_id: "c1",
        properties: { role: "replica", speech: "  hi there  " },
      })
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transcript",
        role: "replica",
        speech: "hi there",
      })
    );
  });

  it("coerces unknown roles to 'user'", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.utterance",
        conversation_id: "c1",
        properties: { role: "bot", speech: "yo" },
      })
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "transcript", role: "user" })
    );
  });

  it("drops transcription_ready payloads (stale-order bleed-through fix)", async () => {
    await POST(
      makeRequest({
        event_type: "application.transcription_ready",
        conversation_id: "c1",
        properties: { transcript: [{ role: "user", content: "old" }] },
      })
    );
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("defaults quantity to 1 when missing or non-positive", async () => {
    await POST(
      makeRequest({
        event_type: "conversation.tool_call",
        conversation_id: "c1",
        properties: {
          tool_name: "add_to_cart",
          arguments: { product_name: "Americano", quantity: 0 },
        },
      })
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ quantity: 1 }),
      })
    );
  });
});
