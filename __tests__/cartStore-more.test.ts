import { describe, it, expect, beforeEach } from "vitest";
import { useCartStore } from "@/store/cartStore";

beforeEach(() => {
  useCartStore.getState().clearCart();
});

describe("cartStore — merge path iterates past non-matching lines", () => {
  it("merging a duplicate of the 2nd item leaves the 1st item unchanged", () => {
    // Exercises the ternary branch in the addItem map at cartStore.ts:82
    // where (idx !== existingIdx) returns the item unmodified. Requires
    // at least 2 items in the cart before the merge.
    useCartStore.getState().addItem({
      product_id: "americano",
      product_name: "Americano",
      quantity: 1,
      unit_price: 4,
    });
    useCartStore.getState().addItem({
      product_id: "matcha",
      product_name: "Matcha",
      quantity: 1,
      unit_price: 7,
    });
    // Now duplicate the 2nd item — forces the map to pass index 0
    // through unchanged and merge at index 1.
    useCartStore.getState().addItem({
      product_id: "matcha",
      product_name: "Matcha",
      quantity: 2,
      unit_price: 7,
    });
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items[0].product_id).toBe("americano");
    expect(items[0].quantity).toBe(1);
    expect(items[1].product_id).toBe("matcha");
    expect(items[1].quantity).toBe(3);
  });
});
