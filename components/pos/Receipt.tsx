"use client";

import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useCartStore } from "@/store/cartStore";

export function Receipt() {
  const snapshot = useCartStore((s) => s.receiptSnapshot);
  const clearCart = useCartStore((s) => s.clearCart);

  // qrData depends solely on the frozen snapshot identity. The snapshot
  // is created once in setReceiptReady(true) and never mutated, so this
  // memo runs at most once per checkout regardless of how often parents
  // re-render.
  const qrData = useMemo(() => {
    if (!snapshot) return "";
    return JSON.stringify({
      order_id: snapshot.orderId,
      items: snapshot.items.map((i) => ({
        name: i.product_name,
        qty: i.quantity,
        size: i.size,
        modifiers: i.modifiers?.map((m) => m.label),
        price: i.line_total,
      })),
      subtotal: Number(snapshot.subtotal.toFixed(2)),
      tax: Number(snapshot.tax.toFixed(2)),
      total: Number(snapshot.total.toFixed(2)),
      timestamp: snapshot.timestamp,
    });
  }, [snapshot]);

  const dateLabel = useMemo(() => {
    if (!snapshot) return "";
    return new Date(snapshot.timestamp).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [snapshot]);

  if (!snapshot) return null;

  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <div className="w-full max-w-sm bg-surface-elevated rounded-2xl p-6 shadow-sm border border-border">
        <div className="text-center mb-6">
          <h2 className="font-display text-2xl font-bold text-text-primary">
            Erewhon Market
          </h2>
          <p className="font-sans text-xs text-text-muted mt-1">{dateLabel}</p>
          <p className="font-sans text-xs text-text-muted">
            Order {snapshot.orderId}
          </p>
        </div>

        <div className="border-t border-dashed border-border mb-4" />

        <div className="space-y-2 mb-4">
          {snapshot.items.map((item, idx) => {
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
            <span className="tabular-nums">
              ${snapshot.subtotal.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between font-sans text-xs text-text-muted">
            <span>Tax (9.5%)</span>
            <span className="tabular-nums">${snapshot.tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-display text-lg font-bold text-text-primary pt-1">
            <span>Total</span>
            <span className="tabular-nums">${snapshot.total.toFixed(2)}</span>
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
    </div>
  );
}
