import { create } from "zustand";
import type { Modifier, OrderItem } from "@/lib/schemas";
import { computeLineTotal, lineKey } from "@/lib/cart";

interface AddPayload {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  size?: string;
  modifiers?: Modifier[];
}

interface CartStore {
  items: OrderItem[];
  receiptReady: boolean;
  orderId: string | null;
  orderTimestamp: string | null;
  addItem: (payload: AddPayload) => void;
  removeItem: (product_id: string) => void;
  removeLine: (line_id: string) => void;
  updateQuantity: (line_id: string, quantity: number) => void;
  clearCart: () => void;
  setReceiptReady: (ready: boolean) => void;
}

function generateOrderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ERW-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
  }
  return `ERW-${Date.now().toString(36).toUpperCase()}`;
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  receiptReady: false,
  orderId: null,
  orderTimestamp: null,

  addItem: (payload) =>
    set((state) => {
      const candidateKey = lineKey({
        product_id: payload.product_id,
        size: payload.size,
        modifiers: payload.modifiers,
      });
      const existingIdx = state.items.findIndex(
        (item) => lineKey(item) === candidateKey
      );

      if (existingIdx >= 0) {
        return {
          items: state.items.map((item, idx) =>
            idx === existingIdx
              ? {
                  ...item,
                  quantity: item.quantity + payload.quantity,
                  line_total: computeLineTotal(
                    item.unit_price,
                    item.quantity + payload.quantity,
                    item.modifiers
                  ),
                }
              : item
          ),
        };
      }

      return {
        items: [
          ...state.items,
          {
            product_id: payload.product_id,
            product_name: payload.product_name,
            quantity: payload.quantity,
            unit_price: payload.unit_price,
            line_total: computeLineTotal(
              payload.unit_price,
              payload.quantity,
              payload.modifiers
            ),
            size: payload.size,
            modifiers: payload.modifiers,
          },
        ],
      };
    }),

  removeItem: (product_id) =>
    set((state) => {
      const firstMatchIdx = state.items.findIndex(
        (item) => item.product_id === product_id
      );
      if (firstMatchIdx < 0) return state;
      return {
        items: state.items.filter((_, idx) => idx !== firstMatchIdx),
      };
    }),

  removeLine: (line_id) =>
    set((state) => ({
      items: state.items.filter((item) => lineKey(item) !== line_id),
    })),

  updateQuantity: (line_id, quantity) =>
    set((state) => {
      if (quantity <= 0) {
        return {
          items: state.items.filter((item) => lineKey(item) !== line_id),
        };
      }
      return {
        items: state.items.map((item) =>
          lineKey(item) === line_id
            ? {
                ...item,
                quantity,
                line_total: computeLineTotal(
                  item.unit_price,
                  quantity,
                  item.modifiers
                ),
              }
            : item
        ),
      };
    }),

  clearCart: () =>
    set({ items: [], receiptReady: false, orderId: null, orderTimestamp: null }),

  setReceiptReady: (ready) =>
    set((state) => {
      if (!ready) {
        return { receiptReady: false, orderId: null, orderTimestamp: null };
      }
      // Generate once per checkout. If somehow called twice while already
      // ready, keep the existing id so the QR does not change.
      if (state.receiptReady && state.orderId) return { receiptReady: true };
      return {
        receiptReady: true,
        orderId: generateOrderId(),
        orderTimestamp: new Date().toISOString(),
      };
    }),
}));

export const selectSubtotal = (state: CartStore): number =>
  state.items.reduce((sum, item) => sum + item.line_total, 0);

export const selectTax = (state: CartStore): number => selectSubtotal(state) * 0.095;

export const selectTotal = (state: CartStore): number =>
  selectSubtotal(state) + selectTax(state);
