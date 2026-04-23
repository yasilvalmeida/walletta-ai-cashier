import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useCartStore,
  selectSubtotal,
  selectTax,
  selectTotal,
} from "@/store/cartStore";

// Stable order IDs for snapshot assertions — avoids coupling the test
// to crypto.randomUUID() output or the Date.now() fallback.
beforeEach(() => {
  useCartStore.getState().clearCart();
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () => "abcd1234-0000-0000-0000-000000000000",
  });
});

const americano = {
  product_id: "americano",
  product_name: "Americano",
  quantity: 1,
  unit_price: 4.5,
};

describe("useCartStore — addItem", () => {
  it("adds a new line", () => {
    useCartStore.getState().addItem(americano);
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      product_id: "americano",
      quantity: 1,
      line_total: 4.5,
    });
  });

  it("merges a second add for the same (product, size, modifiers) tuple", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().addItem({ ...americano, quantity: 2 });
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].quantity).toBe(3);
    expect(s.items[0].line_total).toBeCloseTo(13.5);
  });

  it("keeps separate lines for different sizes of the same product", () => {
    useCartStore.getState().addItem({ ...americano, size: "12oz" });
    useCartStore.getState().addItem({ ...americano, size: "16oz" });
    expect(useCartStore.getState().items).toHaveLength(2);
  });

  it("keeps separate lines when modifiers differ", () => {
    useCartStore
      .getState()
      .addItem({ ...americano, modifiers: [{ label: "Oat", price: 0.75 }] });
    useCartStore
      .getState()
      .addItem({ ...americano, modifiers: [{ label: "Almond", price: 0.75 }] });
    expect(useCartStore.getState().items).toHaveLength(2);
  });

  it("includes modifier price in line_total", () => {
    useCartStore.getState().addItem({
      ...americano,
      quantity: 2,
      modifiers: [{ label: "Oat", price: 0.75 }],
    });
    // (4.5 + 0.75) * 2 = 10.5
    expect(useCartStore.getState().items[0].line_total).toBeCloseTo(10.5);
  });
});

describe("useCartStore — removeItem / removeLine / updateQuantity", () => {
  it("removeItem drops the first matching product line", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().addItem({ ...americano, product_id: "matcha" });
    useCartStore.getState().removeItem("americano");
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].product_id).toBe("matcha");
  });

  it("removeItem is a no-op when nothing matches", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().removeItem("does-not-exist");
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it("removeLine drops the exact lineKey", () => {
    useCartStore.getState().addItem({ ...americano, size: "12oz" });
    useCartStore.getState().addItem({ ...americano, size: "16oz" });
    const targetKey = `americano::16oz::`;
    useCartStore.getState().removeLine(targetKey);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].size).toBe("12oz");
  });

  it("updateQuantity sets the new line total", () => {
    useCartStore.getState().addItem(americano);
    const key = `americano::::`;
    useCartStore.getState().updateQuantity(key, 4);
    const line = useCartStore.getState().items[0];
    expect(line.quantity).toBe(4);
    expect(line.line_total).toBeCloseTo(18);
  });

  it("updateQuantity to 0 removes the line entirely", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().updateQuantity("americano::::", 0);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("updateQuantity ignores lines that don't match", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().updateQuantity("nope::::", 9);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
  });
});

describe("useCartStore — clearCart", () => {
  it("wipes items, snapshot, and readiness flags", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().setReceiptReady(true);
    useCartStore.getState().clearCart();
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.receiptReady).toBe(false);
    expect(s.receiptSnapshot).toBeNull();
    expect(s.orderId).toBeNull();
    expect(s.orderTimestamp).toBeNull();
  });
});

describe("useCartStore — setReceiptReady", () => {
  it("generates a frozen snapshot exactly once", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().setReceiptReady(true);
    const first = useCartStore.getState().receiptSnapshot;
    expect(first).not.toBeNull();
    expect(first?.items).toHaveLength(1);
    expect(first?.subtotal).toBeCloseTo(4.5);
    expect(first?.tax).toBeCloseTo(0.4275);
    expect(first?.total).toBeCloseTo(4.9275);

    // A second call must not regenerate the snapshot — the QR must be
    // stable even if the setter is triggered twice.
    useCartStore.getState().setReceiptReady(true);
    const second = useCartStore.getState().receiptSnapshot;
    expect(second).toBe(first);
  });

  it("false-resets the receipt state", () => {
    useCartStore.getState().addItem(americano);
    useCartStore.getState().setReceiptReady(true);
    useCartStore.getState().setReceiptReady(false);
    const s = useCartStore.getState();
    expect(s.receiptReady).toBe(false);
    expect(s.receiptSnapshot).toBeNull();
    expect(s.orderId).toBeNull();
  });

  it("uses Date.now() fallback when crypto.randomUUID is unavailable", () => {
    // Simulate an older runtime where crypto has no randomUUID — the
    // store must still generate a usable ERW-prefixed id.
    vi.stubGlobal("crypto", {});
    useCartStore.getState().addItem(americano);
    useCartStore.getState().setReceiptReady(true);
    const id = useCartStore.getState().receiptSnapshot?.orderId ?? "";
    expect(id.startsWith("ERW-")).toBe(true);
    expect(id.length).toBeGreaterThan(4);
  });
});

describe("selectors", () => {
  it("subtotal / tax / total match the snapshot math", () => {
    useCartStore.getState().addItem({ ...americano, quantity: 2 });
    useCartStore.getState().addItem({
      product_id: "matcha",
      product_name: "Matcha",
      quantity: 1,
      unit_price: 6,
    });
    const state = useCartStore.getState();
    expect(selectSubtotal(state)).toBeCloseTo(15);
    expect(selectTax(state)).toBeCloseTo(1.425);
    expect(selectTotal(state)).toBeCloseTo(16.425);
  });
});
