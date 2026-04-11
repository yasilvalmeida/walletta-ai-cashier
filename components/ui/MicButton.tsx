"use client";

interface MicButtonProps {
  isListening: boolean;
  isSpeaking: boolean;
  onToggle: () => void;
}

export function MicButton({
  isListening,
  isSpeaking,
  onToggle,
}: MicButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
        isListening
          ? "bg-accent text-white shadow-lg shadow-accent/30 scale-110"
          : "bg-white/10 backdrop-blur-xl text-white/70 border border-white/20 hover:border-white/40"
      } ${isSpeaking ? "ring-2 ring-accent/50 ring-offset-2 ring-offset-black" : ""}`}
      aria-label={isListening ? "Stop listening" : "Start listening"}
    >
      <svg
        className="w-7 h-7"
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
