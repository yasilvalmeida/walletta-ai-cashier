"use client";

import { useCallback, useRef } from "react";
import { useCartStore } from "@/store/cartStore";
import { parseSSEStream } from "@/lib/sse";
import type { OrderItem, SSEEvent } from "@/lib/schemas";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface UseCartOptions {
  onTextDelta?: (delta: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export function useCart(options: UseCartOptions = {}) {
  const { addItem, removeItem, items, setReceiptReady } = useCartStore();
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      messages: { role: "user" | "assistant" | "system"; content: string }[],
      cartContext: OrderItem[],
      retryCount = 0
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, cartContext }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Chat request failed: ${response.status}`);
        }

        const lastMessage = messages[messages.length - 1]?.content.toLowerCase() ?? "";
        if (
          lastMessage.includes("checkout") ||
          lastMessage.includes("pay") ||
          lastMessage.includes("done")
        ) {
          setReceiptReady(true);
        }

        await parseSSEStream(response, {
          onText: (delta) => options.onTextDelta?.(delta),
          onCartAction: (event: SSEEvent) => {
            if (event.type !== "cart_action") return;
            if (event.action === "add_to_cart") {
              addItem(event.payload);
            } else if (event.action === "remove_from_cart") {
              removeItem(event.payload.product_id);
            }
          },
          onDone: () => options.onDone?.(),
          onError: (error) => {
            if (retryCount < MAX_RETRIES) {
              setTimeout(() => {
                sendMessage(messages, cartContext, retryCount + 1);
              }, RETRY_DELAY_MS * (retryCount + 1));
            } else {
              options.onError?.(error);
            }
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        if (retryCount < MAX_RETRIES) {
          setTimeout(() => {
            sendMessage(messages, cartContext, retryCount + 1);
          }, RETRY_DELAY_MS * (retryCount + 1));
        } else {
          options.onError?.(
            err instanceof Error ? err : new Error(String(err))
          );
        }
      }
    },
    [addItem, removeItem, setReceiptReady, options]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { sendMessage, cancel, items };
}
