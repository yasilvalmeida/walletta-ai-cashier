"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useCartStore,
  selectSubtotal,
  selectTax,
  selectTotal,
} from "@/store/cartStore";
import { CartItem } from "@/components/pos/CartItem";
import { Receipt } from "@/components/pos/Receipt";

export function BottomSheet() {
  const [expanded, setExpanded] = useState(false);
  const items = useCartStore((s) => s.items);
  const receiptSnapshot = useCartStore((s) => s.receiptSnapshot);
  const subtotal = useCartStore(selectSubtotal);
  const tax = useCartStore(selectTax);
  const total = useCartStore(selectTotal);
  const prevCountRef = useRef(0);

  // Auto-expand briefly when items change so the customer sees the
  // addition land even if they don't tap the chip open.
  useEffect(() => {
    if (items.length > 0 && items.length !== prevCountRef.current) {
      setExpanded(true);
      prevCountRef.current = items.length;
      const timer = setTimeout(() => setExpanded(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [items.length]);

  // Receipt modal takes the whole viewport once the order is finalised.
  if (receiptSnapshot) {
    return (
      <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm">
        <Receipt />
      </div>
    );
  }

  // Per Temur's Apr 22 feedback: the checkout UI must be a dynamic
  // pop-up that "appears only when necessary". When the cart is empty
  // (pre-order or post-receipt-cleared) we render nothing so the avatar
  // owns the whole screen. The pill returns the instant the LLM fires
  // add_to_cart (the auto-expand effect above catches the transition).
  const isEmpty = items.length === 0;
  if (isEmpty) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      // Drawer, not floating card: flush to the screen edges, rounded
      // only at the top so it reads as a sheet rising from the bottom
      // of the iPad, not a dashboard widget. The mic footer below still
      // has its own safe-area padding — we sit just above it.
      className="absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] left-0 right-0 z-10 glass-theme"
    >
      {/* backdrop-blur-md (12px) not 2xl (40px) — 2xl over the live Tavus
          iframe forces Safari to composite video→blur every frame and
          was a visible source of jank on iPad Pro. */}
      <div className="backdrop-blur-md bg-black/65 border-t border-white/10 rounded-t-3xl overflow-hidden shadow-2xl">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-5 py-3 flex items-center justify-between"
          aria-label="Toggle cart"
        >
          <div className="flex items-center gap-3">
            {/* Cart icon */}
            <svg
              className="w-5 h-5 text-white/70"
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
            <span className="font-sans text-sm text-white/60">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
            <span className="font-sans text-[10px] bg-accent/90 text-black font-semibold px-1.5 py-0.5 rounded-full">
              {items.length}
            </span>
          </div>
          <span className="font-display text-lg font-semibold text-white tabular-nums">
            ${total.toFixed(2)}
          </span>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="border-t border-white/10 px-5 py-3 max-h-[40vh] overflow-y-auto">
                <AnimatePresence mode="popLayout">
                  {items.map((item) => (
                    <CartItem key={item.product_id} item={item} />
                  ))}
                </AnimatePresence>
              </div>

              <div className="border-t border-white/10 px-5 py-3 space-y-1.5">
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
    </motion.div>
  );
}
