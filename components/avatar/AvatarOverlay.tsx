"use client";

import { STATUS_CONFIG } from "@/lib/overlay";
import type { OverlayStatus } from "@/lib/overlay";

interface AvatarOverlayProps {
  status: OverlayStatus;
}

export function AvatarOverlay({ status }: AvatarOverlayProps) {
  const { label, color } = STATUS_CONFIG[status];
  const isActive =
    status === "listening" || status === "speaking" || status === "processing";

  return (
    <div className="flex items-center gap-2 backdrop-blur-xl bg-black/40 rounded-full px-3 py-1.5 border border-white/10">
      <span
        className={`w-2 h-2 rounded-full ${color} ${isActive ? "animate-pulse" : ""}`}
      />
      <span className="font-sans text-xs text-white/70">{label}</span>
    </div>
  );
}
