// @vitest-environment happy-dom
//
// Covers the `if (!activeRef.current) return` at the VERY START of
// useTavus.connect (line 44). activeRef is flipped false in the
// autoConnect effect's cleanup — so the only way to hit line 44 is:
//   1. Render with autoConnect:true
//   2. Capture the returned `connect` function
//   3. Unmount — cleanup runs, activeRef.current = false
//   4. Call connect() on the captured reference
// The closure still holds refs alive; connect runs and bails at line 44.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTavus } from "@/hooks/useTavus";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTavus — connect() after unmount", () => {
  it("bails at the activeRef guard when called post-unmount (line 44)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversationId: "c-should-not-fire",
            conversationUrl: "u",
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() =>
      useTavus({ autoConnect: true, warmupDelayMs: 0 })
    );
    // Wait for the auto-connect fetch to land + settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // Capture a reference, unmount, and then try to connect on the stale ref.
    const captured = result.current.connect;
    unmount();
    fetchMock.mockClear();
    await act(async () => {
      await captured();
    });
    // connect returned at line 44 — no additional fetch was made.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles non-Error rejections in catch (line 72 fallback arm)", async () => {
    vi.stubGlobal(
      "fetch",
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "bare-string";
      })
    );
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe("error");
    // The fallback arm "Tavus connection failed" is the error message
    // when a non-Error is thrown.
    expect(result.current.error).toBe("Tavus connection failed");
  });
});
