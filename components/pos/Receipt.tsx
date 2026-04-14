"use client";

import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  useCartStore,
  selectSubtotal,
  selectTax,
  selectTotal,
} from "@/store/cartStore";

function generateOrderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ERW-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
  }
  return `ERW-${Date.now().toString(36).toUpperCase()}`;
}

export function Receipt() {
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const subtotal = useCartStore(selectSubtotal);
  const tax = useCartStore(selectTax);
  const total = useCartStore(selectTotal);

  const orderId = generateOrderId();
  const timestamp = new Date().toISOString();

  const qrData = JSON.stringify({
    order_id: orderId,
    items: items.map((i) => ({
      name: i.product_name,
      qty: i.quantity,
      size: i.size,
      modifiers: i.modifiers?.map((m) => m.label),
      price: i.line_total,
    })),
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total: Number(total.toFixed(2)),
    timestamp,
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="flex-1 flex flex-col items-center justify-center"
    >
      <div className="w-full max-w-sm bg-surface-elevated rounded-2xl p-6 shadow-sm border border-border">
        <div className="text-center mb-6">
          <h2 className="font-display text-2xl font-bold text-text-primary">
            Erewhon Market
          </h2>
          <p className="font-sans text-xs text-text-muted mt-1">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="font-sans text-xs text-text-muted">Order {orderId}</p>
        </div>

        <div className="border-t border-dashed border-border mb-4" />

        <div className="space-y-2 mb-4">
          {items.map((item, idx) => {
            const details: string[] = [];
            if (item.size) details.push(item.size);
            if (item.modifiers && item.modifiers.length > 0) {
              details.push(...item.modifiers.map((m) => m.label));
            }
            return (
              <div
                key={`${item.product_id}-${idx}`}
                className="font-sans text-sm"
              >
                <div className="flex justify-between">
                  <span className="text-text-primary">
                    {item.product_name}
                    {item.quantity > 1 && (
                      <span className="text-text-muted">
                        {" "}
                        x{item.quantity}
                      </span>
                    )}
                  </span>
                  <span className="text-text-primary tabular-nums">
                    ${item.line_total.toFixed(2)}
                  </span>
                </div>
                {details.length > 0 && (
                  <p className="text-xs text-text-muted mt-0.5">
                    {details.join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-dashed border-border pt-3 space-y-1">
          <div className="flex justify-between font-sans text-xs text-text-muted">
            <span>Subtotal</span>
            <span className="tabular-nums">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-sans text-xs text-text-muted">
            <span>Tax (9.5%)</span>
            <span className="tabular-nums">${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-display text-lg font-bold text-text-primary pt-1">
            <span>Total</span>
            <span className="tabular-nums">${total.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex flex-col items-center mt-6 pt-4 border-t border-dashed border-border">
          <QRCodeSVG
            value={qrData}
            size={180}
            bgColor="transparent"
            fgColor="#1A1714"
            level="M"
          />
          <p className="font-sans text-xs text-text-muted mt-2">
            Scan to save your receipt
          </p>
        </div>

        <button
          onClick={clearCart}
          className="mt-6 w-full py-3 min-h-[44px] bg-accent text-surface-elevated font-sans text-sm font-medium rounded-lg hover:bg-accent-light transition-colors"
        >
          New Order
        </button>
      </div>
    </motion.div>
  );
}
