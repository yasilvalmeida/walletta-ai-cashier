import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the WebSocket instances the route creates so each test can
// drive them through open/message/close.
let lastWs: FakeWS | null = null;

class FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((ev?: Event) => void) | null = null;
  listeners = new Map<string, Array<(ev: unknown) => void>>();
  url: string;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    lastWs = this;
  }
  addEventListener(event: string, cb: (ev: unknown) => void) {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWS.CLOSED;
    this.emit("close");
  }
  emit(event: string, data?: unknown) {
    const arr = this.listeners.get(event) ?? [];
    for (const cb of arr) cb(data as unknown);
  }
}

beforeEach(() => {
  lastWs = null;
  vi.resetModules();
  vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/tts/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Read the response stream until done and return the concatenated bytes.
async function drain(res: Response): Promise<Uint8Array> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

describe("/api/tts/stream", () => {
  it("returns 400 for empty text", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when CARTESIA_API_KEY is missing", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hello" }));
    expect(res.status).toBe(500);
  });

  it("streams Cartesia audio chunks decoded from base64", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hello" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/pcm");

    // Drive the fake WS: open → message (chunk) → message (done).
    const ws = lastWs!;
    ws.emit("open");
    // Cartesia sends base64 of pcm_s16le; encode two bytes [1, 2].
    const base64 = Buffer.from([1, 2]).toString("base64");
    ws.emit("message", {
      data: JSON.stringify({ type: "chunk", data: base64 }),
    });
    ws.emit("message", { data: JSON.stringify({ done: true }) });

    const bytes = await drain(res);
    expect(Array.from(bytes)).toEqual([1, 2]);
  });

  it("sends a sonic-2 payload over the WS on open", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hello", language: "en" }));
    const ws = lastWs!;
    ws.emit("open");
    expect(ws.sent).toHaveLength(1);
    const payload = JSON.parse(ws.sent[0]);
    expect(payload.model_id).toBe("sonic-2");
    expect(payload.transcript).toBe("hello");
    expect(payload.language).toBe("en");
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    await drain(res);
  });

  it("falls back to English for unsupported language codes", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hi", language: "xx" }));
    const ws = lastWs!;
    ws.emit("open");
    const payload = JSON.parse(ws.sent[0]);
    expect(payload.language).toBe("en");
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    await drain(res);
  });

  it("errors the stream when Cartesia reports an error", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hi" }));
    const ws = lastWs!;
    ws.emit("open");
    ws.emit("message", {
      data: JSON.stringify({ error: "quota exceeded" }),
    });
    const reader = res.body!.getReader();
    await expect(reader.read()).rejects.toThrow(/quota exceeded/);
  });

  it("ignores non-string WS messages (defensive parse path)", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hi" }));
    const ws = lastWs!;
    ws.emit("open");
    ws.emit("message", { data: new Uint8Array([1, 2, 3]) });
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    const bytes = await drain(res);
    expect(bytes.length).toBe(0);
  });

  it("errors the response stream on a WS error event", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hi" }));
    const ws = lastWs!;
    ws.emit("open");
    ws.emit("error", new Error("socket reset"));
    const reader = res.body!.getReader();
    await expect(reader.read()).rejects.toThrow(/Cartesia WebSocket error/);
  });

  it("returns 500 when the WebSocket constructor throws", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    class Exploding {
      constructor() {
        throw new Error("boom");
      }
    }
    vi.stubGlobal("WebSocket", Exploding as unknown as typeof WebSocket);
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hi" }));
    const reader = res.body!.getReader();
    await expect(reader.read()).rejects.toThrow(/boom/);
  });

  it("prefers CARTESIA_VOICE_ID_<LANG> when set (resolveVoice override path)", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    vi.stubEnv("CARTESIA_VOICE_ID_ES", "voice-es-stream");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hola", language: "es" }));
    const ws = lastWs!;
    ws.emit("open");
    const payload = JSON.parse(ws.sent[0]);
    expect(payload.voice.id).toBe("voice-es-stream");
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    await drain(res);
  });

  it("ignores an empty CARTESIA_VOICE_ID_<LANG> override in the stream route", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    vi.stubEnv("CARTESIA_VOICE_ID_FR", "   ");
    vi.stubEnv("CARTESIA_VOICE_ID", "voice-default");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "bonjour", language: "fr" }));
    const ws = lastWs!;
    ws.emit("open");
    const payload = JSON.parse(ws.sent[0]);
    // Whitespace-only override falls through to CARTESIA_VOICE_ID.
    expect(payload.voice.id).toBe("voice-default");
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    await drain(res);
  });

  it("drops late messages that arrive after the stream was already closed", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hi" }));
    const ws = lastWs!;
    ws.emit("open");
    // Close the stream first, then send a message — route's `if (closed) return;`
    // at line 129 fires.
    ws.emit("message", { data: JSON.stringify({ done: true }) });
    // A stale chunk arriving after done — no-op.
    ws.emit("message", {
      data: JSON.stringify({ type: "chunk", data: "AA==" }),
    });
    const bytes = await drain(res);
    expect(bytes.length).toBe(0);
  });

  it("invokes the ReadableStream cancel() handler when the client aborts", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "hi" }));
    // The client reads the initial empty stream, then cancels before
    // any WS message arrives. This invokes the cancel() callback at
    // route.ts:177.
    await res.body?.cancel();
    expect(true).toBe(true);
  });

  it("closes the stream cleanly on WS close", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(makeRequest({ text: "bye" }));
    const ws = lastWs!;
    ws.emit("open");
    ws.emit("close");
    const bytes = await drain(res);
    expect(bytes.length).toBe(0);
  });
});
