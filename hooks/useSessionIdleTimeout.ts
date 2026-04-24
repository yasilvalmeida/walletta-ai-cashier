"use client";

import { useCallback, useEffect, useRef } from "react";

// Cost-control timer for the Tavus session. Temur got billed 271 min
// for 15 min of actual testing on 2026-04-24 because sessions kept
// billing in the background after he stopped speaking or minimised the
// page. This hook fires `onTimeout` after `idleMs` of no activity and
// also when the tab goes background, giving the caller a single place
// to wire `tavus.disconnect()`.
//
// Contract:
//   - Caller owns the "active" flag: the timer only runs while the
//     session is live (tavus.status === "ready" | "connected"). Toggle
//     `active` to disarm the hook during idle/error/pitch-setup windows.
//   - Caller calls `resetIdle()` on any activity that should restart
//     the clock: user speech-end, replica speech, fresh connect.
//   - `freeze()`/`unfreeze()` bracket the investor pitch so the clock
//     doesn't fire during the ~60s echo playback.
//   - `visibilitychange → hidden` fires `onTimeout` immediately (no
//     grace period) so background tabs stop billing right away.

interface Options {
  active: boolean;
  idleMs?: number;
  onTimeout: () => void;
}

interface Api {
  resetIdle: () => void;
  freeze: () => void;
  unfreeze: () => void;
}

const DEFAULT_IDLE_MS = 180_000; // 3 minutes — Temur asked for strict 3

export function useSessionIdleTimeout({
  active,
  idleMs = DEFAULT_IDLE_MS,
  onTimeout,
}: Options): Api {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frozenRef = useRef(false);
  // Keep the latest onTimeout reachable from stable callbacks without
  // re-subscribing the visibility listener on every render.
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetIdle = useCallback(() => {
    if (!active || frozenRef.current) return;
    clear();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onTimeoutRef.current();
    }, idleMs);
  }, [active, idleMs, clear]);

  const freeze = useCallback(() => {
    frozenRef.current = true;
    clear();
  }, [clear]);

  const unfreeze = useCallback(() => {
    frozenRef.current = false;
    if (active) resetIdle();
  }, [active, resetIdle]);

  // Arm on activation, disarm on deactivation. Keeps the timer in sync
  // with the Tavus session lifecycle without the caller having to
  // remember to call resetIdle on connect.
  useEffect(() => {
    if (active) {
      resetIdle();
    } else {
      clear();
    }
    return clear;
  }, [active, resetIdle, clear]);

  // Immediate disconnect when the tab goes background — no grace, no
  // client-side voice activity possible while hidden anyway, and this
  // is the bigger of the two bleed scenarios Temur reported.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (!active) return;
      if (document.hidden) {
        clear();
        onTimeoutRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, clear]);

  return { resetIdle, freeze, unfreeze };
}
