"use client";

interface StatusBarProps {
  connected: boolean;
  latencyMs?: number;
}

export function StatusBar({ connected, latencyMs }: StatusBarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border">
      <span
        className={`w-2 h-2 rounded-full ${
          connected ? "bg-success" : "bg-destructive"
        }`}
      />
      <span className="font-sans text-xs text-text-secondary">
        {connected ? "Connected" : "Disconnected"}
      </span>
      {latencyMs !== undefined && (
        <span className="font-sans text-xs text-text-muted ml-auto tabular-nums">
          {latencyMs}ms
        </span>
      )}
    </div>
  );
}
