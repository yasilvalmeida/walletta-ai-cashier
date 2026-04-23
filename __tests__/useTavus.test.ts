// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTavus } from "@/hooks/useTavus";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockSessionOnce(data: Record<string, unknown> | Error) {
  const fetchMock = vi.fn(async () => {
    if (data instanceof Error) throw data;
    return new Response(JSON.stringify(data), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFailingSessionOnce(status: number, body = "bad") {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useTavus", () => {
  it("starts in idle with no session", () => {
    mockSessionOnce({ conversationId: "c1", conversationUrl: "u" });
    const { result } = renderHook(() => useTavus());
    expect(result.current.status).toBe("idle");
    expect(result.current.session).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("connect() hits /api/tavus/session and lands on 'connected'", async () => {
    mockSessionOnce({
      conversationId: "c-1",
      conversationUrl: "https://x/c-1",
      replicaId: "r",
      personaId: "p",
    });
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe("connected");
    expect(result.current.session?.conversationId).toBe("c-1");
  });

  it("markReady promotes connected → ready", async () => {
    mockSessionOnce({ conversationId: "c", conversationUrl: "u" });
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    act(() => {
      result.current.markReady();
    });
    expect(result.current.status).toBe("ready");
  });

  it("records the error and status=error when the session fails", async () => {
    mockFailingSessionOnce(402, "out of credits");
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/402/);
    expect(result.current.error).toMatch(/out of credits/);
  });

  it("deduplicates concurrent connect() calls via the in-flight guard", async () => {
    const fetchMock = mockSessionOnce({ conversationId: "c", conversationUrl: "u" });
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await Promise.all([result.current.connect(), result.current.connect()]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disconnect() fires a best-effort end beacon and clears state", async () => {
    mockSessionOnce({ conversationId: "c-beacon", conversationUrl: "u" });
    const sendBeacon = vi.fn(() => true);
    // @ts-expect-error — minimal sendBeacon stub is enough for the hook.
    navigator.sendBeacon = sendBeacon;
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    act(() => {
      result.current.disconnect();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.session).toBeNull();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url] = sendBeacon.mock.calls[0];
    expect(url).toBe("/api/tavus/end");
  });

  it("falls back to fetch+keepalive when sendBeacon is unavailable", async () => {
    mockSessionOnce({ conversationId: "c-fetch", conversationUrl: "u" });
    // Swap navigator.sendBeacon to undefined.
    // @ts-expect-error — deliberately erasing the method.
    navigator.sendBeacon = undefined;

    // Capture the end-fetch via the same global fetch stub.
    const fetches: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetches.push({ url, init });
        if (url === "/api/tavus/session") {
          return new Response(
            JSON.stringify({
              conversationId: "c-fetch",
              conversationUrl: "u",
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    act(() => {
      result.current.disconnect();
    });
    await waitFor(() => {
      expect(fetches.some((f) => f.url === "/api/tavus/end")).toBe(true);
    });
    const endCall = fetches.find((f) => f.url === "/api/tavus/end");
    expect(endCall?.init?.keepalive).toBe(true);
  });

  it("pagehide handler is a no-op when no session is attached", async () => {
    const { result } = renderHook(() => useTavus());
    expect(result.current.session).toBeNull();
    // Dispatching pagehide when sessionRef.current is null hits the
    // `if (current) endSession(...)` false branch at line 148.
    expect(() => {
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
    }).not.toThrow();
  });

  it("auto-connects on mount when autoConnect is true", async () => {
    const fetchMock = mockSessionOnce({
      conversationId: "c-auto",
      conversationUrl: "u",
    });
    const { result } = renderHook(() =>
      useTavus({ autoConnect: true, warmupDelayMs: 0 })
    );
    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
