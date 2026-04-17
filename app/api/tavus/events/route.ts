import { subscribe } from "@/lib/tavusEvents";

// Force Node.js runtime (not edge) — our in-memory pub/sub in
// lib/tavusEvents.ts only works when the webhook and the SSE route
// share a process. Edge functions are stateless per invocation.
// Also disable caching so the stream is always fresh.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keep the SSE open for up to 5 minutes per connection. EventSource
// auto-reconnects if Vercel drops the function, and the backlog in
// lib/tavusEvents replays missed events to the new subscription.
export const maxDuration = 300;

// GET /api/tavus/events?conversationId=<id>
// Server-Sent Events stream of Tavus transcript + cart_action + finalize
// events for one conversation. The client opens an EventSource, we
// publish-through whatever the webhook receives, and we keep the
// connection alive with a comment ping every 15 s so intermediaries
// don't close it.
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
          event.kind
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
