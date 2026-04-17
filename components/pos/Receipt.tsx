"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useCartStore } from "@/store/cartStore";

type PayMethod = "tap" | "insert" | "swipe" | "apple" | null;

export function Receipt() {
  const snapshot = useCartStore((s) => s.receiptSnapshot);
  const clearCart = useCartStore((s) => s.clearCart);
  const [selectedMethod, setSelectedMethod] = useState<PayMethod>(null);
  const [paid, setPaid] = useState(false);

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

  const onPay = (method: PayMethod) => {
    setSelectedMethod(method);
    // Simulated — in a real deploy this would fire the terminal / Apple
    // Pay sheet / tap-to-pay flow. For the pilot we flash a "paid" state
    // and hold the receipt until the next order.
    setTimeout(() => setPaid(true), 600);
  };

  return (
    <motion.div
      // Slides up from the bottom edge — matches the "cart/menu must
      // seamlessly slide up" UX that was called out in the review.
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className="absolute inset-x-0 bottom-0 top-auto w-full max-h-[92%] overflow-y-auto flex justify-center"
      style={{
        paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-md bg-surface-elevated rounded-t-3xl p-6 shadow-2xl border-t border-x border-border">
        <div className="mx-auto w-10 h-1 rounded-full bg-text-muted/40 mb-5" />

        <div className="text-center mb-5">
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
          <div className="flex justify-between font-display text-xl font-bold text-text-primary pt-1">
            <span>Total</span>
            <span className="tabular-nums">${snapshot.total.toFixed(2)}</span>
          </div>
        </div>

        {!paid ? (
          <div className="mt-5">
            <p className="font-sans text-xs uppercase tracking-wider text-text-muted mb-2">
              Pay with
            </p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <PayOption
                label="Tap"
                selected={selectedMethod === "tap"}
                onClick={() => onPay("tap")}
                icon="tap"
              />
              <PayOption
                label="Insert"
                selected={selectedMethod === "insert"}
                onClick={() => onPay("insert")}
                icon="insert"
              />
              <PayOption
                label="Swipe"
                selected={selectedMethod === "swipe"}
                onClick={() => onPay("swipe")}
                icon="swipe"
              />
            </div>
            <button
              onClick={() => onPay("apple")}
              className="w-full py-2.5 min-h-[44px] bg-black text-white font-sans text-sm font-medium rounded-xl flex items-center justify-center gap-2"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.45-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.45C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              <span>Pay with Apple Pay</span>
            </button>
            {selectedMethod && selectedMethod !== "apple" && (
              <p className="font-sans text-xs text-text-muted text-center mt-3 animate-pulse">
                {selectedMethod === "tap"
                  ? "Tap your card on the reader…"
                  : selectedMethod === "insert"
                    ? "Insert your card chip-first…"
                    : "Swipe your card…"}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-5 text-center py-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mb-2">
              <svg
                className="w-7 h-7 text-success"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-display text-lg text-text-primary">
              Payment received
            </p>
            <p className="font-sans text-xs text-text-muted">
              Thanks — enjoy your order.
            </p>
          </div>
        )}

        <details className="mt-4">
          <summary className="font-sans text-xs text-text-muted cursor-pointer text-center">
            Show QR code
          </summary>
          <div className="flex flex-col items-center mt-3">
            <QRCodeSVG
              value={qrData}
              size={140}
              bgColor="transparent"
              fgColor="#1A1714"
              level="M"
            />
            <p className="font-sans text-xs text-text-muted mt-2">
              Scan to save your receipt
            </p>
          </div>
        </details>

        <button
          onClick={clearCart}
          className="mt-5 w-full py-3 min-h-[44px] border border-border text-text-primary font-sans text-sm font-medium rounded-xl hover:bg-surface-elevated/60 transition-colors"
        >
          New Order
        </button>
      </div>
    </motion.div>
  );
}

interface PayOptionProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  icon: "tap" | "insert" | "swipe";
}

function PayOption({ label, selected, onClick, icon }: PayOptionProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-border bg-surface-elevated/60 hover:border-accent/50"
      }`}
    >
      <svg
        className={`w-6 h-6 ${
          selected ? "text-accent" : "text-text-primary"
        }`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {icon === "tap" && (
          <>
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 14h4" />
            <path d="M14 10.5c.8.5 1.2 1.3 1.2 2s-.4 1.5-1.2 2" />
            <path d="M16 8.5c1.5 1 2.2 2.2 2.2 3.5s-.7 2.5-2.2 3.5" />
          </>
        )}
        {icon === "insert" && (
          <>
            <rect x="5" y="7" width="14" height="14" rx="2" />
            <path d="M9 11h6" />
            <path d="M12 2v5" />
            <path d="M9 4l3-2 3 2" />
          </>
        )}
        {icon === "swipe" && (
          <>
            <rect x="2" y="7" width="20" height="11" rx="2" />
            <path d="M2 11h20" />
            <path d="M7 15l3 2 7-5" />
          </>
        )}
      </svg>
      <span
        className={`font-sans text-xs ${
          selected ? "text-accent font-medium" : "text-text-muted"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
