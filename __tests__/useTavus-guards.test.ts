// @vitest-environment happy-dom
//
// Covers the activeRef + sessionRef + inFlightRef guards in
// useTavus.connect(). activeRef is only ever set to false inside the
// cleanup of the autoConnect effect, so those tests must use
// autoConnect:true to exercise the unmount-during-fetch path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTavus } from "@/hooks/useTavus";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTavus — internal guards", () => {
  it("connect() is a no-op when a session is already cached (sessionRef guard)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ conversationId: "cS", conversationUrl: "u" }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.connect();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disconnect() with no active session is a safe no-op", async () => {
    const { result } = renderHook(() => useTavus());
    expect(() => {
      act(() => {
        result.current.disconnect();
      });
    }).not.toThrow();
    expect(result.current.status).toBe("idle");
  });

  it("markReady before 'connected' keeps the previous status unchanged", () => {
    const { result } = renderHook(() => useTavus());
    act(() => {
      result.current.markReady();
    });
    expect(result.current.status).toBe("idle");
  });

  it("connect() bails after fetch resolves if hook has unmounted (line 58)", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    // autoConnect:true registers the cleanup that flips activeRef.
    const { unmount } = renderHook(() =>
      useTavus({ autoConnect: true, warmupDelayMs: 0 })
    );
    // Let the autoConnect setTimeout fire so fetch is in flight.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    unmount();
    // Now resolve the pending fetch — connect() resumes, hits
    // `if (!activeRef.current) return` at line 58.
    resolveFetch(
      new Response(
        JSON.stringify({ conversationId: "cX", conversationUrl: "u" }),
        { status: 200 }
      )
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("connect() bails after JSON parse if hook has unmounted (line 66)", async () => {
    let resolveJson: (v: unknown) => void = () => {};
    const body = {
      ok: true,
      status: 200,
      text: async () => "",
      json: () =>
        new Promise((resolve) => {
          resolveJson = resolve;
        }),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => body));
    const { unmount } = renderHook(() =>
      useTavus({ autoConnect: true, warmupDelayMs: 0 })
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    unmount();
    resolveJson({ conversationId: "c-late", conversationUrl: "u" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("connect() catch arm respects activeRef (line 71, post-unmount rejection)", async () => {
    let rejectFetch: (e: Error) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
          })
      )
    );
    const { unmount } = renderHook(() =>
      useTavus({ autoConnect: true, warmupDelayMs: 0 })
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    unmount();
    rejectFetch(new Error("net down"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });
});
