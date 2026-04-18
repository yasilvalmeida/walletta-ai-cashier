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

  // Cart chip is ALWAYS visible so the customer can see the cart state
  // at a glance — even when empty. Shows "Cart — empty" or "N items —
  // $XX.YY" and expands on tap / when items are added.
  const isEmpty = items.length === 0;
  return (
    <div className="absolute bottom-[calc(8rem+env(safe-area-inset-bottom))] left-4 right-4 z-10 glass-theme">
      <div className="backdrop-blur-2xl bg-black/50 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <button
          onClick={() => !isEmpty && setExpanded(!expanded)}
          disabled={isEmpty}
          className="w-full px-5 py-3 flex items-center justify-between"
          aria-label={isEmpty ? "Cart is empty" : "Toggle cart"}
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
            {isEmpty ? (
              <span className="font-sans text-sm text-white/50">Cart</span>
            ) : (
              <>
                <span className="font-sans text-sm text-white/60">
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
                {/* Item count badge */}
                <span className="font-sans text-[10px] bg-accent/90 text-black font-semibold px-1.5 py-0.5 rounded-full">
                  {items.length}
                </span>
              </>
            )}
          </div>
          <span className="font-display text-lg font-semibold text-white tabular-nums">
            ${total.toFixed(2)}
          </span>
        </button>

        <AnimatePresence>
          {expanded && !isEmpty && (
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
    </div>
  );
}
