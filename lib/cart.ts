import type { Modifier, OrderItem } from "@/lib/schemas";

interface AddPayload {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  size?: string;
  modifiers?: Modifier[];
}

export function lineKey(
  item: Pick<OrderItem, "product_id" | "size" | "modifiers">
): string {
  const size = item.size ?? "";
  const modifiers = (item.modifiers ?? [])
    .map((m) => m.label)
    .sort()
    .join("|");
  return `${item.product_id}::${size}::${modifiers}`;
}

export function modifierTotal(modifiers: Modifier[] | undefined): number {
  if (!modifiers) return 0;
  return modifiers.reduce((sum, m) => sum + m.price, 0);
}

export function computeLineTotal(
  unit_price: number,
  quantity: number,
  modifiers: Modifier[] | undefined
): number {
  return (unit_price + modifierTotal(modifiers)) * quantity;
}

export function addItemToCart(
  items: OrderItem[],
  payload: AddPayload
): OrderItem[] {
  const candidate: OrderItem = {
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
  };

  const key = lineKey(candidate);
  const existing = items.find((i) => lineKey(i) === key);

  if (existing) {
    return items.map((i) => {
      if (lineKey(i) !== key) return i;
      const nextQty = i.quantity + payload.quantity;
      return {
        ...i,
        quantity: nextQty,
        line_total: computeLineTotal(i.unit_price, nextQty, i.modifiers),
      };
    });
  }

  return [...items, candidate];
}

export function removeItemFromCart(
  items: OrderItem[],
  product_id: string
): OrderItem[] {
  const firstMatchIdx = items.findIndex((i) => i.product_id === product_id);
  if (firstMatchIdx < 0) return items;
  return items.filter((_, idx) => idx !== firstMatchIdx);
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
