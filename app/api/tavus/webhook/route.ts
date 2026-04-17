import { NextResponse } from "next/server";
import { publishEvent, clearConversation } from "@/lib/tavusEvents";
import { getAllProducts } from "@/lib/catalog";
import type { Modifier, Product } from "@/lib/schemas";

// Node.js runtime so this endpoint shares memory with the SSE route's
// pub/sub (lib/tavusEvents). Edge functions are stateless per
// invocation and would silently drop every tool-call event.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TavusEventBody {
  event_type?: string;
  message_type?: string;
  conversation_id?: string;
  properties?: Record<string, unknown>;
}

function readString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function resolveProduct(
  name: string,
  sizeLabel?: string,
  modifierLabels?: string[]
): {
  product: Product;
  unit_price: number;
  size?: string;
  modifiers?: Modifier[];
} | null {
  const lower = name.toLowerCase().trim();
  if (!lower) return null;
  const products = getAllProducts();
  const candidates = [
    (p: Product) => p.name.toLowerCase() === lower,
    (p: Product) => p.display_name.toLowerCase() === lower,
    (p: Product) =>
      p.name.toLowerCase().includes(lower) ||
      lower.includes(p.name.toLowerCase()),
    (p: Product) =>
      p.search_keywords.some((kw) => kw.toLowerCase() === lower),
  ];
  let product: Product | undefined;
  for (const pred of candidates) {
    product = products.find(pred);
    if (product) break;
  }
  if (!product) return null;

  let unit_price = product.price;
  let size: string | undefined;
  if (sizeLabel && product.sizes) {
    const s = product.sizes.find(
      (x) => x.label.toLowerCase() === sizeLabel.toLowerCase()
    );
    if (s) {
      unit_price += s.price_delta;
      size = s.label;
    }
  }

  let modifiers: Modifier[] | undefined;
  if (modifierLabels && modifierLabels.length > 0) {
    const found: Modifier[] = [];
    for (const label of modifierLabels) {
      const c = product.customizations.find(
        (x) => x.label.toLowerCase() === label.toLowerCase()
      );
      if (c) found.push({ label: c.label, price: c.price });
    }
    if (found.length > 0) modifiers = found;
  }

  return { product, unit_price, size, modifiers };
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request) {
  let body: TavusEventBody;
  try {
    body = (await request.json()) as TavusEventBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 }
    );
  }

  const conversationId = body.conversation_id;
  if (!conversationId) {
    return NextResponse.json({ ok: true, note: "no conversation_id" });
  }

  const eventType = body.event_type ?? body.message_type ?? "";
  console.log("[Tavus webhook] event:", eventType, conversationId);

  // PRIMARY SIGNAL — tool calls from the persona's LLM. This is how the
  // avatar's cart updates reach the client in real time.
  if (
    eventType === "conversation.tool_call" ||
    eventType === "conversation.toolcall"
  ) {
    const props = body.properties ?? {};
    const rec = props as Record<string, unknown>;
    const toolName =
      readString(rec, "tool_name") ??
      readString(rec, "name") ??
      readString(rec, "function_name") ??
      "";
    const args = parseToolArgs(
      rec.arguments ?? rec.args ?? rec.parameters
    );
    console.log("[Tavus webhook] tool_call:", toolName, JSON.stringify(args));

    if (toolName === "finalize_order") {
      publishEvent({
        kind: "finalize",
        conversationId,
        timestamp: Date.now(),
      });
    } else if (toolName === "add_to_cart") {
      const productName =
        typeof args.product_name === "string" ? args.product_name : "";
      const quantity =
        typeof args.quantity === "number" && args.quantity > 0
          ? Math.floor(args.quantity)
          : 1;
      const sizeLabel =
        typeof args.size === "string" ? args.size : undefined;
      const modifierLabels = Array.isArray(args.modifiers)
        ? args.modifiers.filter((x): x is string => typeof x === "string")
        : undefined;
      const resolved = resolveProduct(productName, sizeLabel, modifierLabels);
      if (resolved) {
        publishEvent({
          kind: "cart_action",
          conversationId,
          action: "add",
          payload: {
            product_id: resolved.product.id,
            product_name:
              resolved.product.display_name || resolved.product.name,
            quantity,
            unit_price: resolved.unit_price,
            size: resolved.size,
            modifiers: resolved.modifiers,
          },
          timestamp: Date.now(),
        });
      } else {
        console.warn(
          "[Tavus webhook] add_to_cart: could not resolve product",
          productName
        );
      }
    } else if (toolName === "remove_from_cart") {
      const productName =
        typeof args.product_name === "string" ? args.product_name : "";
      const resolved = resolveProduct(productName);
      if (resolved) {
        publishEvent({
          kind: "cart_action",
          conversationId,
          action: "remove",
          payload: {
            product_id: resolved.product.id,
            product_name:
              resolved.product.display_name || resolved.product.name,
            quantity: 0,
            unit_price: 0,
          },
          timestamp: Date.now(),
        });
      }
    }
  }

  // Secondary — live user transcripts (for diagnostic/fallback; primary
  // cart signal is tool_call above).
  if (
    eventType === "conversation.utterance" ||
    eventType === "conversation.utterance_streaming" ||
    eventType.startsWith("conversation.utterance")
  ) {
    const props = body.properties ?? {};
    const role = (readString(props, "role") ??
      readString(props, "speaker") ??
      "user") as "user" | "replica" | "system";
    const speech =
      readString(props, "speech") ??
      readString(props, "transcript") ??
      readString(props, "text") ??
      "";
    if (speech.trim()) {
      publishEvent({
        kind: "transcript",
        conversationId,
        role: role === "replica" || role === "system" ? role : "user",
        speech: speech.trim(),
        timestamp: Date.now(),
      });
    }
  }

  // Post-call cleanup
  if (
    eventType.includes("shutdown") ||
    eventType.includes("ended") ||
    eventType === "conversation.ended"
  ) {
    clearConversation(conversationId);
  }

  return NextResponse.json({ ok: true });
}
