"use client";

import { useCartStore } from "@/store/cartStore";
import { Receipt } from "@/components/pos/Receipt";

// Receipt overlay. The cart-drawer behaviour previously housed here
// moved into BasketButton (top-right popover) per Temur's 2026-04-24
// IMG_0036.png reference. This component only renders the final
// receipt modal once the order is finalised — keeping the avatar
// stage chrome-free during ordering.
export function BottomSheet() {
  const receiptSnapshot = useCartStore((s) => s.receiptSnapshot);
  if (!receiptSnapshot) return null;
  return (
    <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm">
      <Receipt />
    </div>
  );
}
