"use client";

interface AvatarOverlayProps {
  status: "idle" | "connecting" | "connected" | "speaking" | "error";
}

export function AvatarOverlay({ status }: AvatarOverlayProps) {
  const statusConfig = {
    idle: { label: "Standby", color: "bg-text-muted" },
    connecting: { label: "Connecting...", color: "bg-accent-light" },
    connected: { label: "Connected", color: "bg-success" },
    speaking: { label: "Speaking", color: "bg-accent" },
    error: { label: "Error", color: "bg-destructive" },
  };

  const { label, color } = statusConfig[status];

  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-surface/80 backdrop-blur-sm rounded-full px-3 py-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="font-sans text-xs text-text-secondary">{label}</span>
    </div>
  );
}
