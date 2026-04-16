// In-memory pub/sub keyed by Tavus conversation id. The webhook pushes
// events in; the SSE endpoint reads them out and streams to the client.
//
// Caveat: this only works when a single Node process owns the state
// (ngrok/local dev, or a single long-running server). On Vercel's
// serverless functions each invocation is a fresh instance and this
// pub/sub breaks — prod needs Vercel KV / Upstash Redis. Out of scope
// for the current demo.

export interface TavusTranscriptEvent {
  conversationId: string;
  role: "user" | "replica" | "system";
  speech: string;
  timestamp: number;
}

type Listener = (event: TavusTranscriptEvent) => void;

const listeners = new Map<string, Set<Listener>>();
// Keep the last ~50 events per conversation so a late SSE subscriber can
// replay anything it missed between session creation and connect.
const backlog = new Map<string, TavusTranscriptEvent[]>();
const BACKLOG_LIMIT = 50;

export function publishTranscript(event: TavusTranscriptEvent): void {
  const bucket = backlog.get(event.conversationId) ?? [];
  bucket.push(event);
  while (bucket.length > BACKLOG_LIMIT) bucket.shift();
  backlog.set(event.conversationId, bucket);

  const set = listeners.get(event.conversationId);
  console.log(
    "[tavusEvents] publish",
    event.conversationId,
    event.role,
    `"${event.speech.slice(0, 60)}"`,
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

  // Replay backlog so late subscribers don't miss early utterances.
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
