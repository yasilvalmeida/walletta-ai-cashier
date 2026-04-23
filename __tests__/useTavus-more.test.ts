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

describe("useTavus — sendBeacon returns false → fetch keepalive fallback", () => {
  it("falls through to fetch when sendBeacon returns false", async () => {
    // sendBeacon is a known-flaky primitive — some platforms return
    // false when the payload exceeds quota or a CSP blocks it. The
    // hook should retry via fetch(keepalive: true) in that case.
    const sendBeacon = vi.fn(() => false);
    // @ts-expect-error — minimal stub
    navigator.sendBeacon = sendBeacon;
    const urls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push({ url, init });
        if (url === "/api/tavus/session") {
          return new Response(
            JSON.stringify({ conversationId: "c-beacon-false", conversationUrl: "u" }),
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
      expect(urls.some((u) => u.url === "/api/tavus/end")).toBe(true);
    });
    const endCall = urls.find((u) => u.url === "/api/tavus/end");
    expect(endCall?.init?.keepalive).toBe(true);
  });

  it("endSession is a best-effort no-op on thrown fetch errors", async () => {
    // @ts-expect-error
    navigator.sendBeacon = undefined;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tavus/session") {
        return new Response(
          JSON.stringify({ conversationId: "c-err", conversationUrl: "u" }),
          { status: 200 }
        );
      }
      throw new Error("net down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    // disconnect must not throw even though the fetch will reject.
    expect(() => {
      act(() => {
        result.current.disconnect();
      });
    }).not.toThrow();
  });

  it("endSession swallows a completely thrown body-builder error", async () => {
    // Force JSON.stringify to throw by feeding a circular structure
    // through a custom sendBeacon that reads body length.
    // @ts-expect-error
    navigator.sendBeacon = () => {
      throw new Error("beacon boom");
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/tavus/session") {
          return new Response(
            JSON.stringify({ conversationId: "c-try", conversationUrl: "u" }),
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
    // The try/catch at the end of endSession must swallow this.
    expect(() => {
      act(() => {
        result.current.disconnect();
      });
    }).not.toThrow();
  });
});
