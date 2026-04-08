"use client";

interface MicButtonProps {
  isListening: boolean;
  isSpeaking: boolean;
  onToggle: () => void;
}

export function MicButton({ isListening, isSpeaking, onToggle }: MicButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
        isListening
          ? "bg-accent text-surface-elevated shadow-lg scale-110"
          : "bg-surface-elevated text-text-secondary border border-border hover:border-accent"
      } ${isSpeaking ? "ring-2 ring-accent-light ring-offset-2 ring-offset-surface" : ""}`}
      aria-label={isListening ? "Stop listening" : "Start listening"}
    >
      <svg
        className="w-6 h-6"
        fill={isListening ? "currentColor" : "none"}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={isListening ? 0 : 1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
        />
      </svg>
    </button>
  );
}
