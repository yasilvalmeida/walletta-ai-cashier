import { subscribe } from "@/lib/tavusEvents";

// GET /api/tavus/events?conversationId=<id>
// Server-Sent Events stream of Tavus transcript events for one
// conversation. The client opens an EventSource, we publish-through
// whatever the webhook receives, and we keep the connection alive
// with a comment ping every 15 s so intermediaries don't close it.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return new Response("Missing conversationId", { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream already closed; stop writing.
        }
      };
      console.log("[tavusEvents] SSE subscribe", conversationId);
      write(`: connected ${conversationId}\n\n`);
      unsubscribe = subscribe(conversationId, (event) => {
        console.log(
          "[tavusEvents] SSE deliver",
          event.conversationId,
          event.role
        );
        const payload = JSON.stringify(event);
        write(`data: ${payload}\n\n`);
      });
      pingInterval = setInterval(() => {
        write(`: ping\n\n`);
      }, 15000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (pingInterval) clearInterval(pingInterval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
