import type { SSEEvent } from "@/lib/schemas";

export interface SSECallbacks {
  onText: (delta: string) => void;
  onCartAction: (event: SSEEvent) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export async function parseSSEStream(
  response: Response,
  callbacks: SSECallbacks
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("No response body"));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr) as SSEEvent;

          if (event.type === "text") {
            callbacks.onText(event.delta);
          } else if (event.type === "cart_action") {
            callbacks.onCartAction(event);
          } else if (event.type === "done") {
            callbacks.onDone();
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    reader.releaseLock();
  }
}
