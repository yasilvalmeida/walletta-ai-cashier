export type ConversationPhase =
  | "idle"
  | "listening"
  | "processing"
  | "responding"
  | "error";

export type OverlayStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export interface StatusDisplay {
  label: string;
  color: string;
}

export const STATUS_CONFIG: Record<OverlayStatus, StatusDisplay> = {
  idle: { label: "Standby", color: "bg-text-muted" },
  connecting: { label: "Connecting...", color: "bg-accent-light" },
  connected: { label: "Connected", color: "bg-success" },
  listening: { label: "Listening...", color: "bg-accent" },
  processing: { label: "Thinking...", color: "bg-accent-light" },
  speaking: { label: "Speaking", color: "bg-accent" },
  error: { label: "Error", color: "bg-destructive" },
};

export function getOverlayStatus(
  phase: ConversationPhase,
  deepgramStatus: string
): OverlayStatus {
  if (phase === "error") return "error";
  if (deepgramStatus === "connecting") return "connecting";
  if (phase === "responding") return "speaking";
  if (phase === "processing") return "processing";
  if (phase === "listening") return "listening";
  if (deepgramStatus === "connected") return "connected";
  return "idle";
}
