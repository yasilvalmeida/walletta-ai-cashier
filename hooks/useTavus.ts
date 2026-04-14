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
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(true);

  const connect = useCallback(async () => {
    if (!activeRef.current) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("connecting");
    setError(null);

    try {
      const res = await fetch("/api/tavus/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Tavus session failed: ${res.status} ${body}`);
      }

      const data = (await res.json()) as TavusSession;
      if (!activeRef.current) return;
      setSession(data);
      setStatus("connected");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Tavus connection failed";
      if (!activeRef.current) return;
      setError(msg);
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
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
      abortRef.current?.abort();
    };
  }, [autoConnect, warmupDelayMs, connect]);

  return { session, status, error, connect, disconnect, markReady };
}
