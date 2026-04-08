import { describe, it, expect } from "vitest";
import {
  ChatRequestSchema,
  CartEventAddSchema,
  CartEventRemoveSchema,
  OrderItemSchema,
} from "@/lib/schemas";

describe("Zod schemas", () => {
  it("validates a valid ChatRequest", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: "user", content: "I want a matcha" }],
      cartContext: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects ChatRequest with invalid role", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: "invalid", content: "hi" }],
      cartContext: [],
    });
    expect(result.success).toBe(false);
  });

  it("validates add_to_cart event", () => {
    const result = CartEventAddSchema.safeParse({
      type: "cart_action",
      action: "add_to_cart",
      payload: {
        product_id: "smoothie-matcha-power",
        product_name: "Matcha Power",
        quantity: 1,
        unit_price: 19.0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects add_to_cart with missing product_name", () => {
    const result = CartEventAddSchema.safeParse({
      type: "cart_action",
      action: "add_to_cart",
      payload: {
        product_id: "smoothie-matcha-power",
        quantity: 1,
        unit_price: 19.0,
      },
    });
    expect(result.success).toBe(false);
  });

  it("validates remove_from_cart event", () => {
    const result = CartEventRemoveSchema.safeParse({
      type: "cart_action",
      action: "remove_from_cart",
      payload: { product_id: "coffee-americano" },
    });
    expect(result.success).toBe(true);
  });

  it("validates OrderItem", () => {
    const result = OrderItemSchema.safeParse({
      product_id: "coffee-americano",
      product_name: "Americano",
      quantity: 2,
      unit_price: 5.0,
      line_total: 10.0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects OrderItem with zero quantity", () => {
    const result = OrderItemSchema.safeParse({
      product_id: "coffee-americano",
      product_name: "Americano",
      quantity: 0,
      unit_price: 5.0,
      line_total: 0,
    });
    expect(result.success).toBe(false);
  });
});
