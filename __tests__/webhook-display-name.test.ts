// Covers the `resolved.product.display_name || resolved.product.name`
// short-circuit in the tavus webhook — exercising the right-hand-side
// `name` arm when display_name is empty.

import { describe, it, expect, vi, beforeEach } from "vitest";

const publishMock = vi.fn();
vi.mock("@/lib/tavusEvents", () => ({
  publishEvent: (...a: unknown[]) => publishMock(...a),
}));

vi.mock("@/lib/catalog", () => ({
  getAllProducts: () => [
    {
      id: "bare",
      name: "bare-name",
      display_name: "", // intentionally falsy so the || falls through
      price: 3,
      search_keywords: [],
      sizes: [],
      customizations: [],
    },
    {
      id: "named",
      name: "api-name",
      display_name: "Display Name",
      price: 4,
      search_keywords: ["api-name"],
      sizes: [],
      customizations: [],
    },
  ],
}));

import { POST } from "@/app/api/tavus/webhook/route";

beforeEach(() => {
  publishMock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("/api/tavus/webhook — display_name fallback", () => {
  it("uses product.display_name when it's truthy (line 185 truthy arm)", async () => {
    await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "conversation.tool_call",
          conversation_id: "c1",
          properties: {
            tool_name: "add_to_cart",
            arguments: { product_name: "api-name", quantity: 1 },
          },
        }),
      })
    );
    const call = publishMock.mock.calls[0]?.[0] as {
      payload: { product_name: string };
    };
    expect(call.payload.product_name).toBe("Display Name");
  });

  it("remove_from_cart: uses product.display_name when truthy (line 185 truthy arm)", async () => {
    await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "conversation.tool_call",
          conversation_id: "c1",
          properties: {
            tool_name: "remove_from_cart",
            arguments: { product_name: "api-name" },
          },
        }),
      })
    );
    const call = publishMock.mock.calls[0]?.[0] as {
      payload: { product_name: string };
    };
    expect(call.payload.product_name).toBe("Display Name");
  });

  it("remove_from_cart: falls back to product.name when display_name is empty (line 185 false arm)", async () => {
    await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "conversation.tool_call",
          conversation_id: "c1",
          properties: {
            tool_name: "remove_from_cart",
            arguments: { product_name: "bare-name" },
          },
        }),
      })
    );
    const call = publishMock.mock.calls[0]?.[0] as {
      payload: { product_name: string };
    };
    expect(call.payload.product_name).toBe("bare-name");
  });

  it("uses product.name when display_name is empty", async () => {
    await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "conversation.tool_call",
          conversation_id: "c1",
          properties: {
            tool_name: "add_to_cart",
            arguments: { product_name: "bare-name", quantity: 1 },
          },
        }),
      })
    );
    const call = publishMock.mock.calls[0]?.[0] as {
      payload: { product_name: string };
    };
    expect(call.payload.product_name).toBe("bare-name");
  });
});
