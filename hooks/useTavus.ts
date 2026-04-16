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

  const disconnect = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    setStatus("idle");
    setError(null);
  }, []);

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
    };
  }, [autoConnect, warmupDelayMs, connect]);

  return { session, status, error, connect, disconnect, markReady };
}
