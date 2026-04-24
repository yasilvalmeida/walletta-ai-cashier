"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

// Cost-control timer for the Tavus session. Temur got billed 271 min
// for 15 min of actual testing on 2026-04-24 because sessions kept
// billing in the background after he stopped speaking or minimised the
// page. This hook fires `onTimeout` after `idleMs` of no activity and
// also when the tab goes background for more than HIDDEN_GRACE_MS,
// giving the caller a single place to wire `tavus.disconnect()`.
//
// Contract:
//   - Caller owns the "active" flag: the timer only runs while the
//     session is live (tavus.status === "ready" | "connected"). Toggle
//     `active` to disarm the hook during idle/error/pitch-setup windows.
//   - Caller calls `resetIdle()` on any activity that should restart
//     the clock: user speech-end, replica speech, fresh connect.
//   - `freeze()`/`unfreeze()` bracket the investor pitch so the clock
//     doesn't fire during the ~60s echo playback.
//   - `visibilitychange → hidden` waits HIDDEN_GRACE_MS before firing
//     `onTimeout`. iOS Safari emits visibilitychange while the
//     getUserMedia permission prompt is on screen — without the grace
//     window, tapping the mic the first time would disconnect Tavus
//     mid-prompt and break the cascade (avatar dies, Deepgram loses
//     the shared mic track, customer can't be heard). 5s comfortably
//     covers permission prompts while still capping background bleed.

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
const HIDDEN_GRACE_MS = 5_000;

export function useSessionIdleTimeout({
  active,
  idleMs = DEFAULT_IDLE_MS,
  onTimeout,
}: Options): Api {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frozenRef = useRef(false);
  // Keep the latest onTimeout reachable from stable callbacks without
  // re-subscribing the visibility listener on every render.
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearHiddenTimer = useCallback(() => {
    if (hiddenTimerRef.current !== null) {
      clearTimeout(hiddenTimerRef.current);
      hiddenTimerRef.current = null;
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

  // Background-tab disconnect with a grace period (see HIDDEN_GRACE_MS
  // comment at top). iOS Safari fires visibilitychange while modal
  // permission prompts (mic, camera) are on screen — the page returns
  // to visible within ~1-2s once the user taps Allow. Disconnecting
  // immediately would break the very interaction the user just opted
  // into. So we set a 5s timer on hidden, cancel on visible.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (!active) return;
      if (document.hidden) {
        clearHiddenTimer();
        hiddenTimerRef.current = setTimeout(() => {
          hiddenTimerRef.current = null;
          // Re-check at fire time — if the page came back to visible
          // we should have already cleared this timer, but be defensive.
          if (document.hidden) {
            clear();
            onTimeoutRef.current();
          }
        }, HIDDEN_GRACE_MS);
      } else {
        // Visibility restored within the grace window → cancel.
        clearHiddenTimer();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearHiddenTimer();
    };
  }, [active, clear, clearHiddenTimer]);

  // Stable identity so consumers can put the returned object in
  // useEffect deps without churning every render.
  return useMemo(
    () => ({ resetIdle, freeze, unfreeze }),
    [resetIdle, freeze, unfreeze]
  );
}
