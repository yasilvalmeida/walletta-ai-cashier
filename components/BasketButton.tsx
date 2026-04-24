"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useCartStore,
  selectSubtotal,
  selectTax,
  selectTotal,
} from "@/store/cartStore";
import { CartItem } from "@/components/pos/CartItem";

// Basket button — top-right corner per Temur's IMG_0036.png reference.
// Always visible (even with an empty cart) so the customer has a
// constant affordance, with a small numeric badge that appears as soon
// as the LLM fires add_to_cart. Tapping opens a popover anchored just
// below the button with the line-item breakdown + totals.
//
// Replaces the bottom-rising drawer that used to live in BottomSheet.
// The drawer covered the bottom third of the avatar; the popover sits
// in the upper-right corner and frees the avatar to fill the screen.
export function BasketButton() {
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore(selectSubtotal);
  const tax = useCartStore(selectTax);
  const total = useCartStore(selectTotal);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Tap-outside to close. Necessary because the popover sits over the
  // avatar; without this, the customer has to tap the basket icon
  // again to dismiss, which feels modal in a way the rest of the UI
  // isn't.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const node = containerRef.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // Close the popover automatically when the cart empties (e.g. after
  // the receipt closes). Keeps state from going stale.
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div ref={containerRef} className="absolute z-30 top-0 right-0">
      <div
        className="p-3"
        style={{
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={
            itemCount === 0 ? "Cart, empty" : `Cart, ${itemCount} items`
          }
          aria-expanded={open}
          className="relative w-11 h-11 rounded-full backdrop-blur-md bg-black/55 border border-white/15 flex items-center justify-center text-white/85 hover:bg-black/65 active:bg-black/75 transition-colors shadow-lg"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="9" cy="20" r="1.4" />
            <circle cx="18" cy="20" r="1.4" />
            <path d="M3 4h2l2.4 11.5a2 2 0 002 1.5h8.2a2 2 0 002-1.5L21.5 8H6" />
          </svg>
          {itemCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full bg-accent text-black font-sans text-[11px] font-semibold flex items-center justify-center"
              aria-hidden
            >
              {itemCount}
            </span>
          )}
        </button>
      </div>

      <AnimatePresence>
        {open && items.length > 0 && (
          <motion.div
            key="basket-popover"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="absolute right-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.25rem)] w-[22rem] max-w-[calc(100vw-1.5rem)] backdrop-blur-md bg-black/75 border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
            role="dialog"
            aria-label="Cart contents"
          >
            <div className="px-4 py-3 max-h-[50vh] overflow-y-auto">
              <AnimatePresence mode="popLayout">
                {items.map((item) => (
                  <CartItem key={item.product_id} item={item} />
                ))}
              </AnimatePresence>
            </div>
            <div className="border-t border-white/10 px-4 py-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="font-sans text-xs text-white/45 uppercase tracking-wider">
                  Subtotal
                </span>
                <span className="font-display text-sm text-white/70 tabular-nums">
                  ${subtotal.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-xs text-white/45 uppercase tracking-wider">
                  Tax (9.5%)
                </span>
                <span className="font-display text-sm text-white/70 tabular-nums">
                  ${tax.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-white/10 pt-1.5 flex justify-between">
                <span className="font-sans text-sm font-medium text-white uppercase tracking-wider">
                  Total
                </span>
                <span className="font-display text-xl font-bold text-white tabular-nums">
                  ${total.toFixed(2)}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
