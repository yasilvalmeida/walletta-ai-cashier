"use client";

import { AvatarOverlay } from "@/components/avatar/AvatarOverlay";

export function AvatarPanel() {
  return (
    <div className="relative h-full w-full bg-surface-elevated flex items-center justify-center">
      {/* Tavus Daily.co iframe or LiveKit video will be rendered here */}
      <div className="flex flex-col items-center gap-4">
        <div className="w-32 h-32 rounded-full bg-accent/10 flex items-center justify-center">
          <svg
            className="w-16 h-16 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        </div>
        <p className="font-sans text-sm text-text-muted">
          Avatar will connect when API keys are configured
        </p>
      </div>
      <AvatarOverlay status="idle" />
    </div>
  );
}
