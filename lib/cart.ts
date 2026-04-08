import type { OrderItem } from "@/lib/schemas";

export function addItemToCart(
  items: OrderItem[],
  payload: {
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
  }
): OrderItem[] {
  const existing = items.find((i) => i.product_id === payload.product_id);
  if (existing) {
    return items.map((i) =>
      i.product_id === payload.product_id
        ? {
            ...i,
            quantity: i.quantity + payload.quantity,
            line_total: (i.quantity + payload.quantity) * i.unit_price,
          }
        : i
    );
  }
  return [
    ...items,
    {
      ...payload,
      line_total: payload.quantity * payload.unit_price,
    },
  ];
}

export function removeItemFromCart(
  items: OrderItem[],
  product_id: string
): OrderItem[] {
  return items.filter((i) => i.product_id !== product_id);
}

export function calculateSubtotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.line_total, 0);
}

export function calculateTax(subtotal: number): number {
  return subtotal * 0.095;
}

export function calculateTotal(items: OrderItem[]): number {
  const subtotal = calculateSubtotal(items);
  return subtotal + calculateTax(subtotal);
}
