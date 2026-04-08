"use client";

type OverlayStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

interface AvatarOverlayProps {
  status: OverlayStatus;
}

const STATUS_CONFIG: Record<OverlayStatus, { label: string; color: string }> = {
  idle: { label: "Standby", color: "bg-text-muted" },
  connecting: { label: "Connecting...", color: "bg-accent-light" },
  connected: { label: "Connected", color: "bg-success" },
  listening: { label: "Listening...", color: "bg-accent" },
  processing: { label: "Thinking...", color: "bg-accent-light" },
  speaking: { label: "Speaking", color: "bg-accent" },
  error: { label: "Error", color: "bg-destructive" },
};

export function AvatarOverlay({ status }: AvatarOverlayProps) {
  const { label, color } = STATUS_CONFIG[status];
  const isActive = status === "listening" || status === "speaking" || status === "processing";

  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-surface/80 backdrop-blur-sm rounded-full px-3 py-1.5">
      <span
        className={`w-2 h-2 rounded-full ${color} ${isActive ? "animate-pulse" : ""}`}
      />
      <span className="font-sans text-xs text-text-secondary">{label}</span>
    </div>
  );
}
