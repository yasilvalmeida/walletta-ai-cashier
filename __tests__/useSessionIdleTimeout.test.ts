// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionIdleTimeout } from "@/hooks/useSessionIdleTimeout";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSessionIdleTimeout", () => {
  it("fires onTimeout after idleMs when active", () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionIdleTimeout({ active: true, idleMs: 1000, onTimeout })
    );
    act(() => vi.advanceTimersByTime(999));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("defaults to 3 minutes when idleMs is omitted", () => {
    const onTimeout = vi.fn();
    renderHook(() => useSessionIdleTimeout({ active: true, onTimeout }));
    act(() => vi.advanceTimersByTime(180_000 - 10));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("resetIdle extends the clock", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionIdleTimeout({ active: true, idleMs: 1000, onTimeout })
    );
    act(() => vi.advanceTimersByTime(900));
    act(() => result.current.resetIdle());
    act(() => vi.advanceTimersByTime(900));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("freeze halts the timer; unfreeze restarts it", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionIdleTimeout({ active: true, idleMs: 1000, onTimeout })
    );
    act(() => result.current.freeze());
    act(() => vi.advanceTimersByTime(5000));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => result.current.unfreeze());
    act(() => vi.advanceTimersByTime(999));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("resetIdle is a no-op while frozen", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useSessionIdleTimeout({ active: true, idleMs: 1000, onTimeout })
    );
    act(() => result.current.freeze());
    act(() => result.current.resetIdle());
    act(() => vi.advanceTimersByTime(5000));
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("visibilitychange → hidden fires onTimeout after a 5s grace window", () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionIdleTimeout({ active: true, idleMs: 60_000, onTimeout })
    );
    // Simulate the tab going background.
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Grace window: should NOT have fired yet.
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(4_999));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2));
    expect(onTimeout).toHaveBeenCalledTimes(1);
    // Reset so subsequent tests see a visible document.
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("visibility returning to visible within the grace window cancels the disconnect", () => {
    // This is the iOS Safari permission-prompt case: visibilitychange fires
    // hidden while the mic permission modal is on screen, then returns to
    // visible ~1s later when the user taps Allow. We must NOT disconnect.
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionIdleTimeout({ active: true, idleMs: 60_000, onTimeout })
    );
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Inside the grace window, page returns to visible.
    act(() => vi.advanceTimersByTime(1_500));
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Even after the original 5s grace would have elapsed, we should not fire.
    act(() => vi.advanceTimersByTime(10_000));
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("visibilitychange while inactive is ignored (no spurious disconnects)", () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionIdleTimeout({ active: false, idleMs: 60_000, onTimeout })
    );
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(onTimeout).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("active=false disarms the timer entirely", () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useSessionIdleTimeout({ active: false, idleMs: 100, onTimeout })
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("toggling active on arms the timer from scratch", () => {
    const onTimeout = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useSessionIdleTimeout({ active, idleMs: 1000, onTimeout }),
      { initialProps: { active: false } }
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(onTimeout).not.toHaveBeenCalled();
    rerender({ active: true });
    act(() => vi.advanceTimersByTime(1001));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("clears the pending timer when the hook unmounts", () => {
    const onTimeout = vi.fn();
    const { unmount } = renderHook(() =>
      useSessionIdleTimeout({ active: true, idleMs: 1000, onTimeout })
    );
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
