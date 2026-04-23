import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally before importing the route
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock env vars
vi.stubEnv("CARTESIA_API_KEY", "test-key-123");

import { POST } from "@/app/api/tts/route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/tts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for missing text", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing");
  });

  it("returns 400 for empty text", async () => {
    const response = await POST(makeRequest({ text: "" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for whitespace-only text", async () => {
    const response = await POST(makeRequest({ text: "   " }));
    expect(response.status).toBe(400);
  });

  it("calls Cartesia API with correct parameters", async () => {
    const fakeWav = new ArrayBuffer(100);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeWav, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      })
    );

    await POST(makeRequest({ text: "Hello there" }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(options.method).toBe("POST");

    const headers = options.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test-key-123");
    expect(headers["Cartesia-Version"]).toBe("2024-06-10");

    const body = JSON.parse(options.body as string);
    expect(body.model_id).toBe("sonic-2");
    expect(body.transcript).toBe("Hello there");
    expect(body.voice.mode).toBe("id");
    expect(body.output_format.container).toBe("wav");
    expect(body.language).toBe("en");
  });

  it("returns audio/wav on success", async () => {
    const fakeWav = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer; // "RIFF"
    mockFetch.mockResolvedValueOnce(
      new Response(fakeWav, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      })
    );

    const response = await POST(makeRequest({ text: "Test" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
  });

  it("returns 502 when Cartesia API fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 })
    );

    const response = await POST(makeRequest({ text: "Test" }));
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toContain("TTS generation failed");
  });

  it("returns 500 when fetch throws network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network unreachable"));

    const response = await POST(makeRequest({ text: "Test" }));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain("Network unreachable");
  });

  it("ignores an empty CARTESIA_VOICE_ID_<LANG> env and falls back (line 29 branch)", async () => {
    vi.stubEnv("CARTESIA_VOICE_ID_DE", "   ");
    const fakeWav = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce(new Response(fakeWav, { status: 200 }));
    await POST(makeRequest({ text: "hallo", language: "de" }));
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    // Since the override was whitespace-only, the default voice kicks in.
    expect(body.voice.id).not.toBe("   ");
  });

  it("short-circuits ?warmup=1 to 204 without hitting Cartesia", async () => {
    const res = await POST(
      new Request("http://localhost/api/tts?warmup=1", { method: "POST" })
    );
    expect(res.status).toBe(204);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 500 when CARTESIA_API_KEY is missing", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeRequest({ text: "hello" }));
    expect(res.status).toBe(500);
    vi.stubEnv("CARTESIA_API_KEY", "test-key-123");
  });

  it("falls back to English for unsupported language codes", async () => {
    const fakeWav = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeWav, { status: 200 })
    );
    await POST(makeRequest({ text: "hola", language: "xx" }));
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(body.language).toBe("en");
  });

  it("uses a supported non-English language when provided", async () => {
    const fakeWav = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeWav, { status: 200 })
    );
    await POST(makeRequest({ text: "bonjour", language: "fr" }));
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(body.language).toBe("fr");
  });

  it("prefers CARTESIA_VOICE_ID_<LANG> when set for the given language", async () => {
    vi.stubEnv("CARTESIA_VOICE_ID_ES", "voice-spanish-123");
    const fakeWav = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeWav, { status: 200 })
    );
    await POST(makeRequest({ text: "hola", language: "es" }));
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(body.voice.id).toBe("voice-spanish-123");
    vi.unstubAllEnvs();
    vi.stubEnv("CARTESIA_API_KEY", "test-key-123");
  });

  it("trims whitespace from input text", async () => {
    const fakeWav = new ArrayBuffer(100);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeWav, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      })
    );

    await POST(makeRequest({ text: "  Hello  " }));

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(body.transcript).toBe("Hello");
  });
});
