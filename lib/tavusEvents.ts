import type { Modifier } from "@/lib/schemas";

// Discriminated union of everything the client SSE stream can carry.
// Transcripts are still published for diagnostics; the primary cart
// signal is now cart_action / finalize (driven by Tavus tool calls).
export type TavusChannelEvent =
  | {
      kind: "transcript";
      conversationId: string;
      role: "user" | "replica" | "system";
      speech: string;
      timestamp: number;
    }
  | {
      kind: "cart_action";
      conversationId: string;
      action: "add" | "remove";
      payload: {
        product_id: string;
        product_name: string;
        quantity: number;
        unit_price: number;
        size?: string;
        modifiers?: Modifier[];
      };
      timestamp: number;
    }
  | {
      kind: "finalize";
      conversationId: string;
      timestamp: number;
    };

type Listener = (event: TavusChannelEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const backlog = new Map<string, TavusChannelEvent[]>();
const BACKLOG_LIMIT = 50;

export function publishEvent(event: TavusChannelEvent): void {
  const bucket = backlog.get(event.conversationId) ?? [];
  bucket.push(event);
  while (bucket.length > BACKLOG_LIMIT) bucket.shift();
  backlog.set(event.conversationId, bucket);

  const set = listeners.get(event.conversationId);
  console.log(
    "[tavusEvents]",
    event.kind,
    event.conversationId,
    `listeners=${set?.size ?? 0}`
  );
  if (!set) return;
  for (const l of set) {
    try {
      l(event);
    } catch {
      // listener errors must not kill the loop
    }
  }
}

export function subscribe(
  conversationId: string,
  listener: Listener
): () => void {
  let set = listeners.get(conversationId);
  if (!set) {
    set = new Set();
    listeners.set(conversationId, set);
  }
  set.add(listener);

  const history = backlog.get(conversationId);
  if (history) {
    for (const event of history) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  return () => {
    const current = listeners.get(conversationId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(conversationId);
  };
}

export function clearConversation(conversationId: string): void {
  listeners.delete(conversationId);
  backlog.delete(conversationId);
}
