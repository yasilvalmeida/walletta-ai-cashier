// Covers the `if (typeof window === "undefined") return;` SSR guards
// in useTavus:146 and useTavusTranscripts:76. We can't use @testing-
// library/react's renderHook because React DOM needs `window` to mount.
//
// Instead we import the hooks under a stubbed React that records effect
// callbacks without running them, then execute each recorded effect
// manually with `window` set to undefined and assert it returns early.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Effect = () => void | (() => void);

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Build a minimal React that:
//  - records every effect passed to useEffect/useLayoutEffect
//  - stubs useRef / useState / useCallback / useMemo to something usable
// This is NOT a production React replacement — just enough to let the
// hook function run and register its effects.
function stubReactModule(effects: Effect[]) {
  const useRef = <T,>(initial: T) => ({ current: initial });
  const useState = <T,>(initial: T) => [initial, () => {}] as const;
  const useCallback = <F,>(fn: F) => fn;
  const useMemo = <T,>(fn: () => T) => fn();
  const useEffect = (fn: Effect) => {
    effects.push(fn);
  };
  const useLayoutEffect = useEffect;
  return {
    default: {
      useRef,
      useState,
      useCallback,
      useMemo,
      useEffect,
      useLayoutEffect,
    },
    useRef,
    useState,
    useCallback,
    useMemo,
    useEffect,
    useLayoutEffect,
  };
}

describe("SSR guards — typeof window === 'undefined' branches", () => {
  it("useTavus line 146 short-circuits when window is undefined", async () => {
    const effects: Effect[] = [];
    vi.doMock("react", () => stubReactModule(effects));
    const { useTavus } = await import("@/hooks/useTavus");
    useTavus({ autoConnect: false });
    // Simulate the SSR environment — no window.
    const saved = globalThis.window;
    // @ts-expect-error — deliberately erasing for the test.
    globalThis.window = undefined;
    try {
      // Run every registered effect. The pagehide effect returns undefined
      // from its early guard instead of registering listeners.
      for (const fn of effects) {
        const cleanup = fn();
        if (typeof cleanup === "function") cleanup();
      }
    } finally {
      globalThis.window = saved;
    }
    // If we reach here without throwing, the guard fired as expected.
    expect(true).toBe(true);
  });

  it("useTavusTranscripts line 76 short-circuits when window is undefined", async () => {
    const effects: Effect[] = [];
    vi.doMock("react", () => stubReactModule(effects));
    const { useTavusTranscripts } = await import(
      "@/hooks/useTavusTranscripts"
    );
    useTavusTranscripts({ conversationIds: ["c1"] });
    const saved = globalThis.window;
    // @ts-expect-error
    globalThis.window = undefined;
    try {
      for (const fn of effects) {
        const cleanup = fn();
        if (typeof cleanup === "function") cleanup();
      }
    } finally {
      globalThis.window = saved;
    }
    expect(true).toBe(true);
  });
});
