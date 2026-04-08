"use client";

import { motion } from "framer-motion";
import { useCartStore } from "@/store/cartStore";
import type { OrderItem } from "@/lib/schemas";

interface CartItemProps {
  item: OrderItem;
}

export function CartItem({ item }: CartItemProps) {
  const removeItem = useCartStore((s) => s.removeItem);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="group flex items-center justify-between py-3 px-2 rounded-lg hover:bg-background/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="font-sans text-sm font-medium text-text-primary truncate">
          {item.product_name}
        </p>
        <p className="font-sans text-xs text-text-muted mt-0.5">
          {item.quantity} x ${item.unit_price.toFixed(2)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-display text-base font-semibold text-text-primary tabular-nums">
          ${item.line_total.toFixed(2)}
        </span>
        <button
          onClick={() => removeItem(item.product_id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded-full text-text-muted hover:text-destructive hover:bg-destructive/10"
          aria-label={`Remove ${item.product_name}`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
