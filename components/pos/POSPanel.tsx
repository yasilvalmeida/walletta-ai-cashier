"use client";

import { useCartStore } from "@/store/cartStore";
import { CartItem } from "@/components/pos/CartItem";
import { CartSummary } from "@/components/pos/CartSummary";
import { Receipt } from "@/components/pos/Receipt";
import { AnimatePresence } from "framer-motion";

export function POSPanel() {
  const { items, receiptReady } = useCartStore();

  if (receiptReady) {
    return (
      <div className="h-full flex flex-col bg-surface p-6">
        <Receipt />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <h1 className="font-display text-2xl font-semibold text-text-primary tracking-tight">
          Erewhon Market
        </h1>
        <p className="font-sans text-xs text-text-muted mt-0.5">
          AI-Powered Checkout
        </p>
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <p className="font-sans text-sm text-text-muted">
              Your cart is empty
            </p>
            <p className="font-sans text-xs text-text-muted mt-1">
              Speak to add items
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <CartItem key={item.product_id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Summary */}
      {items.length > 0 && (
        <div className="border-t border-border">
          <CartSummary />
        </div>
      )}
    </div>
  );
}
