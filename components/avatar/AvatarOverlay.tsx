"use client";

import { STATUS_CONFIG } from "@/lib/overlay";
import type { OverlayStatus } from "@/lib/overlay";

interface AvatarOverlayProps {
  status: OverlayStatus;
}

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
