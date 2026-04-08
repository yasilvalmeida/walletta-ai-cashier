import { describe, it, expect, vi } from "vitest";
import { parseSSEStream } from "@/lib/sse";

function createMockResponse(sseData: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseData));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("parseSSEStream", () => {
  it("calls onText for text events", async () => {
    const onText = vi.fn();
    const response = createMockResponse(
      'data: {"type":"text","delta":"Hello"}\n\ndata: {"type":"text","delta":" world"}\n\ndata: {"type":"done"}\n\n'
    );

    await parseSSEStream(response, {
      onText,
      onCartAction: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    });

    expect(onText).toHaveBeenCalledTimes(2);
    expect(onText).toHaveBeenCalledWith("Hello");
    expect(onText).toHaveBeenCalledWith(" world");
  });

  it("calls onCartAction for cart events", async () => {
    const onCartAction = vi.fn();
    const event = {
      type: "cart_action",
      action: "add_to_cart",
      payload: {
        product_id: "coffee-americano",
        product_name: "Americano",
        quantity: 1,
        unit_price: 5.0,
      },
    };

    const response = createMockResponse(
      `data: ${JSON.stringify(event)}\n\ndata: {"type":"done"}\n\n`
    );

    await parseSSEStream(response, {
      onText: vi.fn(),
      onCartAction,
      onDone: vi.fn(),
      onError: vi.fn(),
    });

    expect(onCartAction).toHaveBeenCalledTimes(1);
    expect(onCartAction).toHaveBeenCalledWith(event);
  });

  it("calls onDone when stream completes — the TTS trigger point", async () => {
    const onDone = vi.fn();
    const response = createMockResponse(
      'data: {"type":"text","delta":"Hi"}\n\ndata: {"type":"done"}\n\n'
    );

    await parseSSEStream(response, {
      onText: vi.fn(),
      onCartAction: vi.fn(),
      onDone,
      onError: vi.fn(),
    });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("handles text + cart_action + done in correct order", async () => {
    const callOrder: string[] = [];

    const response = createMockResponse(
      'data: {"type":"text","delta":"Added!"}\n\n' +
        'data: {"type":"cart_action","action":"add_to_cart","payload":{"product_id":"coffee-americano","product_name":"Americano","quantity":1,"unit_price":5}}\n\n' +
        'data: {"type":"done"}\n\n'
    );

    await parseSSEStream(response, {
      onText: () => callOrder.push("text"),
      onCartAction: () => callOrder.push("cart_action"),
      onDone: () => callOrder.push("done"),
      onError: vi.fn(),
    });

    expect(callOrder).toEqual(["text", "cart_action", "done"]);
  });

  it("skips malformed JSON lines gracefully", async () => {
    const onText = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const response = createMockResponse(
      'data: INVALID_JSON\n\ndata: {"type":"text","delta":"OK"}\n\ndata: {"type":"done"}\n\n'
    );

    await parseSSEStream(response, {
      onText,
      onCartAction: vi.fn(),
      onDone,
      onError,
    });

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("OK");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onDone even when stream has only done event (tool-calls-only response)", async () => {
    const onText = vi.fn();
    const onDone = vi.fn();

    const response = createMockResponse(
      'data: {"type":"cart_action","action":"add_to_cart","payload":{"product_id":"smoothie-matcha-power","product_name":"Matcha Power","quantity":1,"unit_price":19}}\n\n' +
        'data: {"type":"done"}\n\n'
    );

    await parseSSEStream(response, {
      onText,
      onCartAction: vi.fn(),
      onDone,
      onError: vi.fn(),
    });

    // onText never called — TTS won't trigger for empty responses (correct behavior)
    expect(onText).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
