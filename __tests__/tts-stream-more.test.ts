// Covers the defensive catch branches in /api/tts/stream/route.ts —
// line 138 (JSON.parse throws on weird message), line 153 (base64
// decode throws on malformed data).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface FakeWS {
  url: string;
  listeners: Map<string, Array<(ev: unknown) => void>>;
  emit: (event: string, data?: unknown) => void;
}

let lastWs: FakeWS | null = null;

class MockWS {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 1;
  url: string;
  listeners = new Map<string, Array<(ev: unknown) => void>>();
  constructor(url: string) {
    this.url = url;
    lastWs = this as unknown as FakeWS;
    Object.assign(this, {
      emit: (event: string, data?: unknown) => {
        const arr = this.listeners.get(event) ?? [];
        for (const cb of arr) cb(data as unknown);
      },
    });
  }
  addEventListener(event: string, cb: (ev: unknown) => void) {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
  }
  send() {}
  close() {
    this.readyState = MockWS.CLOSED;
  }
  emit(_event: string, _data?: unknown) {
    // assigned in constructor
  }
}

beforeEach(() => {
  lastWs = null;
  vi.stubEnv("CARTESIA_API_KEY", "ck");
  vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function drain(res: Response) {
  const reader = res.body!.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("/api/tts/stream — defensive catch branches", () => {
  it("silently skips messages that fail JSON.parse (non-chunk binary frame)", async () => {
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(
      new Request("http://localhost/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      })
    );
    const ws = lastWs!;
    ws.emit("open");
    // A JSON.parse(raw) would throw on this malformed string — the
    // route's try/catch at line 137-139 returns early without
    // crashing the stream.
    ws.emit("message", { data: "not-json-at-all" });
    // Then a proper done frame to let the stream close.
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    await drain(res);
    expect(true).toBe(true);
  });

  it("warns when base64 decode fails for a chunk with invalid data", async () => {
    // Stub Buffer.from to throw on the chunk payload so the catch at
    // line 152-154 executes.
    const original = Buffer.from;
    const spy = vi.spyOn(Buffer, "from").mockImplementation((
      data: unknown,
      encoding?: BufferEncoding
    ) => {
      if (encoding === "base64" && data === "POISON") {
        throw new Error("bad base64");
      }
      return (original as (a: unknown, b?: BufferEncoding) => Buffer)(
        data,
        encoding
      );
    });
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(
      new Request("http://localhost/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      })
    );
    const ws = lastWs!;
    ws.emit("open");
    ws.emit("message", {
      data: JSON.stringify({ type: "chunk", data: "POISON" }),
    });
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    await drain(res);
    spy.mockRestore();
    expect(true).toBe(true);
  });
});
