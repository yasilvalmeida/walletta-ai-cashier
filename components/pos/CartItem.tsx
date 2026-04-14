"use client";

import { motion } from "framer-motion";
import { useCartStore } from "@/store/cartStore";
import { lineKey } from "@/lib/cart";
import type { OrderItem } from "@/lib/schemas";

interface CartItemProps {
  item: OrderItem;
}

export function CartItem({ item }: CartItemProps) {
  const removeLine = useCartStore((s) => s.removeLine);
  const detailBits: string[] = [];
  if (item.size) detailBits.push(item.size);
  if (item.modifiers && item.modifiers.length > 0) {
    detailBits.push(...item.modifiers.map((m) => m.label));
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="group flex items-start justify-between py-3 px-2 rounded-lg hover:bg-background/50 transition-colors"
    >
      <div className="flex-1 min-w-0 pr-3">
        <p className="font-sans text-sm font-medium text-text-primary truncate">
          {item.product_name}
        </p>
        <p className="font-sans text-xs text-text-muted mt-0.5">
          {item.quantity} x ${item.unit_price.toFixed(2)}
        </p>
        {detailBits.length > 0 && (
          <p className="font-sans text-[11px] text-text-muted/80 mt-1 leading-snug">
            {detailBits.join(" · ")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-display text-base font-semibold text-text-primary tabular-nums">
          ${item.line_total.toFixed(2)}
        </span>
        <button
          onClick={() => removeLine(lineKey(item))}
          className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-destructive hover:bg-destructive/10"
          aria-label={`Remove ${item.product_name}`}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
