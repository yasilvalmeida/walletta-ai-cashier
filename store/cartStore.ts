import { create } from "zustand";
import type { OrderItem } from "@/lib/schemas";

interface CartStore {
  items: OrderItem[];
  receiptReady: boolean;
  addItem: (payload: {
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
  }) => void;
  removeItem: (product_id: string) => void;
  updateQuantity: (product_id: string, quantity: number) => void;
  clearCart: () => void;
  setReceiptReady: (ready: boolean) => void;
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  receiptReady: false,

  addItem: (payload) =>
    set((state) => {
      const existing = state.items.find(
        (item) => item.product_id === payload.product_id
      );
      if (existing) {
        return {
          items: state.items.map((item) =>
            item.product_id === payload.product_id
              ? {
                  ...item,
                  quantity: item.quantity + payload.quantity,
                  line_total:
                    (item.quantity + payload.quantity) * item.unit_price,
                }
              : item
          ),
        };
      }
      return {
        items: [
          ...state.items,
          {
            ...payload,
            line_total: payload.quantity * payload.unit_price,
          },
        ],
      };
    }),

  removeItem: (product_id) =>
    set((state) => ({
      items: state.items.filter((item) => item.product_id !== product_id),
    })),

  updateQuantity: (product_id, quantity) =>
    set((state) => {
      if (quantity <= 0) {
        return {
          items: state.items.filter((item) => item.product_id !== product_id),
        };
      }
      return {
        items: state.items.map((item) =>
          item.product_id === product_id
            ? { ...item, quantity, line_total: quantity * item.unit_price }
            : item
        ),
      };
    }),

  clearCart: () => set({ items: [], receiptReady: false }),

  setReceiptReady: (ready) => set({ receiptReady: ready }),
}));

// Computed selectors — use these in components for derived values
export const selectSubtotal = (state: CartStore) =>
  state.items.reduce((sum, item) => sum + item.line_total, 0);

export const selectTax = (state: CartStore) => selectSubtotal(state) * 0.095;

export const selectTotal = (state: CartStore) =>
  selectSubtotal(state) + selectTax(state);
