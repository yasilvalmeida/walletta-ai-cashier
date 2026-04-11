"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCartStore, selectSubtotal, selectTax, selectTotal } from "@/store/cartStore";
import { CartItem } from "@/components/pos/CartItem";
import { Receipt } from "@/components/pos/Receipt";

export function BottomSheet() {
  const [expanded, setExpanded] = useState(false);
  const items = useCartStore((s) => s.items);
  const receiptReady = useCartStore((s) => s.receiptReady);
  const subtotal = useCartStore(selectSubtotal);
  const tax = useCartStore(selectTax);
  const total = useCartStore(selectTotal);
  const prevCountRef = useRef(0);

  // Auto-expand briefly when items change
  useEffect(() => {
    if (items.length > 0 && items.length !== prevCountRef.current) {
      setExpanded(true);
      prevCountRef.current = items.length;
      const timer = setTimeout(() => setExpanded(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [items.length]);

  if (items.length === 0 && !receiptReady) return null;

  if (receiptReady) {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="glass-theme">
          <Receipt />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-20 left-4 right-4 z-10 glass-theme">
      <div className="backdrop-blur-2xl bg-black/50 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        {/* Handle + collapsed summary */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-5 py-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-1 rounded-full bg-white/25" />
            <span className="font-sans text-sm text-white/60">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
          </div>
          <span className="font-display text-lg font-semibold text-white tabular-nums">
            ${total.toFixed(2)}
          </span>
        </button>

        {/* Expanded cart content */}
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

              {/* Summary */}
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
