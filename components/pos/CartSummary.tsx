"use client";

import { useCartStore, selectSubtotal, selectTax, selectTotal } from "@/store/cartStore";

export function CartSummary() {
  const subtotal = useCartStore(selectSubtotal);
  const tax = useCartStore(selectTax);
  const total = useCartStore(selectTotal);

  return (
    <div className="px-6 py-4 space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="font-sans text-xs text-text-muted uppercase tracking-wider">
          Subtotal
        </span>
        <span className="font-display text-sm text-text-secondary tabular-nums">
          ${subtotal.toFixed(2)}
        </span>
      </div>
      <div className="flex justify-between items-baseline">
        <span className="font-sans text-xs text-text-muted uppercase tracking-wider">
          Tax (9.5%)
        </span>
        <span className="font-display text-sm text-text-secondary tabular-nums">
          ${tax.toFixed(2)}
        </span>
      </div>
      <div className="border-t border-border pt-2 flex justify-between items-baseline">
        <span className="font-sans text-sm font-medium text-text-primary uppercase tracking-wider">
          Total
        </span>
        <span className="font-display text-2xl font-bold text-text-primary tabular-nums">
          ${total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
