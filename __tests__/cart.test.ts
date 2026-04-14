import { describe, it, expect } from "vitest";
import {
  addItemToCart,
  removeItemFromCart,
  calculateSubtotal,
  calculateTax,
  calculateTotal,
} from "@/lib/cart";
import type { OrderItem } from "@/lib/schemas";

const mockItem = {
  product_id: "smoothie-strawberry-glaze",
  product_name: "Strawberry Glaze",
  quantity: 1,
  unit_price: 20.0,
};

describe("cart logic", () => {
  it("adds a new item to empty cart", () => {
    const cart = addItemToCart([], mockItem);
    expect(cart).toHaveLength(1);
    expect(cart[0].product_id).toBe("smoothie-strawberry-glaze");
    expect(cart[0].line_total).toBe(20.0);
  });

  it("increments quantity for existing item", () => {
    const cart = addItemToCart([], mockItem);
    const updated = addItemToCart(cart, { ...mockItem, quantity: 2 });
    expect(updated).toHaveLength(1);
    expect(updated[0].quantity).toBe(3);
    expect(updated[0].line_total).toBe(60.0);
  });

  it("adds different items as separate rows", () => {
    const cart = addItemToCart([], mockItem);
    const updated = addItemToCart(cart, {
      product_id: "coffee-americano",
      product_name: "Americano",
      quantity: 1,
      unit_price: 5.0,
    });
    expect(updated).toHaveLength(2);
  });

  it("removes an item", () => {
    const cart = addItemToCart([], mockItem);
    const after = removeItemFromCart(cart, "smoothie-strawberry-glaze");
    expect(after).toHaveLength(0);
  });

  it("removing a nonexistent item does nothing", () => {
    const cart = addItemToCart([], mockItem);
    const after = removeItemFromCart(cart, "nonexistent");
    expect(after).toHaveLength(1);
  });

  it("calculates subtotal", () => {
    const items: OrderItem[] = [
      { ...mockItem, line_total: 20.0 },
      {
        product_id: "coffee-americano",
        product_name: "Americano",
        quantity: 2,
        unit_price: 5.0,
        line_total: 10.0,
      },
    ];
    expect(calculateSubtotal(items)).toBe(30.0);
  });

  it("calculates tax at 9.5%", () => {
    expect(calculateTax(100)).toBeCloseTo(9.5);
    expect(calculateTax(30)).toBeCloseTo(2.85);
  });

  it("calculates total (subtotal + tax)", () => {
    const items: OrderItem[] = [{ ...mockItem, line_total: 20.0 }];
    const total = calculateTotal(items);
    expect(total).toBeCloseTo(21.9); // 20 + 1.90
  });

  it("empty cart totals zero", () => {
    expect(calculateSubtotal([])).toBe(0);
    expect(calculateTax(0)).toBe(0);
    expect(calculateTotal([])).toBe(0);
  });

  it("same product with different modifiers creates separate lines", () => {
    const first = addItemToCart([], {
      product_id: "coffee-americano",
      product_name: "Americano",
      quantity: 1,
      unit_price: 5.0,
      modifiers: [{ label: "Splash of Oat Milk", price: 0.75 }],
    });
    const next = addItemToCart(first, {
      product_id: "coffee-americano",
      product_name: "Americano",
      quantity: 1,
      unit_price: 5.0,
    });
    expect(next).toHaveLength(2);
    expect(next[0].line_total).toBeCloseTo(5.75);
    expect(next[1].line_total).toBeCloseTo(5.0);
  });

  it("same product with identical modifiers stacks quantity", () => {
    const addPayload = {
      product_id: "coffee-americano",
      product_name: "Americano",
      quantity: 1,
      unit_price: 5.0,
      size: "16oz",
      modifiers: [{ label: "Extra Shot", price: 2.25 }],
    };
    const first = addItemToCart([], addPayload);
    const next = addItemToCart(first, addPayload);
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(2);
    expect(next[0].line_total).toBeCloseTo((5.0 + 2.25) * 2);
  });
});
