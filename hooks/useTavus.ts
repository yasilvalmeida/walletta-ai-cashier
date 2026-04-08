"use client";

import { useState, useCallback } from "react";

interface TavusSession {
  conversationId: string;
  conversationUrl: string;
}

type TavusStatus = "idle" | "connecting" | "connected" | "error";

interface UseTavusReturn {
  session: TavusSession | null;
  status: TavusStatus;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useTavus(): UseTavusReturn {
  const [session, setSession] = useState<TavusSession | null>(null);
  const [status, setStatus] = useState<TavusStatus>("idle");

  const connect = useCallback(async () => {
    setStatus("connecting");
    try {
      const res = await fetch("/api/tavus/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        throw new Error(`Tavus session failed: ${res.status}`);
      }

      const data = (await res.json()) as TavusSession;
      setSession(data);
      setStatus("connected");
    } catch {
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    setSession(null);
    setStatus("idle");
  }, []);

  return { session, status, connect, disconnect };
}
