"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface TavusSession {
  conversationId: string;
  conversationUrl: string;
  replicaId: string;
  personaId: string;
}

type TavusStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "ready"
  | "error";

interface UseTavusOptions {
  autoConnect?: boolean;
  warmupDelayMs?: number;
}

interface UseTavusReturn {
  session: TavusSession | null;
  status: TavusStatus;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  markReady: () => void;
}

export function useTavus(options: UseTavusOptions = {}): UseTavusReturn {
  const { autoConnect = false, warmupDelayMs = 0 } = options;

  const [session, setSession] = useState<TavusSession | null>(null);
  const [status, setStatus] = useState<TavusStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const inFlightRef = useRef(false);
  const sessionRef = useRef<TavusSession | null>(null);

  const connect = useCallback(async () => {
    if (!activeRef.current) return;
    if (inFlightRef.current) return;
    if (sessionRef.current) return;
    inFlightRef.current = true;

    setStatus("connecting");
    setError(null);

    try {
      const res = await fetch("/api/tavus/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!activeRef.current) return;

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Tavus session failed: ${res.status} ${body}`);
      }

      const data = (await res.json()) as TavusSession;
      if (!activeRef.current) return;
      sessionRef.current = data;
      setSession(data);
      setStatus("connected");
    } catch (err) {
      if (!activeRef.current) return;
      const msg = err instanceof Error ? err.message : "Tavus connection failed";
      setError(msg);
      setStatus("error");
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const endSession = useCallback((conversationId: string) => {
    // Fire-and-forget. Tavus' free tier caps concurrent conversations,
    // so ending sessions on unmount / page-close is essential to avoid
    // "User has reached maximum concurrent conversations" 400 errors.
    try {
      const body = JSON.stringify({ conversationId });
      // sendBeacon is preferred on page unload because it survives the
      // tab closing; fall back to fetch for programmatic disconnects.
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
      ) {
        const blob = new Blob([body], { type: "application/json" });
        const sent = navigator.sendBeacon("/api/tavus/end", blob);
        if (sent) return;
      }
      void fetch("/api/tavus/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        // best-effort; ignore
      });
    } catch {
      // best-effort; ignore
    }
  }, []);

  const disconnect = useCallback(() => {
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    setStatus("idle");
    setError(null);
    if (current) endSession(current.conversationId);
  }, [endSession]);

  const markReady = useCallback(() => {
    setStatus((prev) => (prev === "connected" ? "ready" : prev));
  }, []);

  useEffect(() => {
    activeRef.current = true;
    if (!autoConnect) return;

    const timer = setTimeout(() => {
      void connect();
    }, warmupDelayMs);

    return () => {
      activeRef.current = false;
      clearTimeout(timer);
      // End the Tavus conversation when this hook unmounts (route change,
      // page close, React fast refresh). Otherwise the session lingers on
      // Tavus' side and counts against the concurrent-conversation cap.
      const current = sessionRef.current;
      if (current) {
        sessionRef.current = null;
        endSession(current.conversationId);
      }
    };
  }, [autoConnect, warmupDelayMs, connect, endSession]);

  // Extra safety net: end the session on tab close / navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      const current = sessionRef.current;
      if (current) endSession(current.conversationId);
    };
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, [endSession]);

  return { session, status, error, connect, disconnect, markReady };
}
