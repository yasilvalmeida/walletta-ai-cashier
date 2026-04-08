import { describe, it, expect } from "vitest";
import {
  getOverlayStatus,
  STATUS_CONFIG,
  type ConversationPhase,
  type OverlayStatus,
} from "@/lib/overlay";

describe("getOverlayStatus", () => {
  it("maps idle phase to 'idle' (Standby)", () => {
    expect(getOverlayStatus("idle", "idle")).toBe("idle");
  });

  it("maps responding phase to 'speaking' — the TTS playback state", () => {
    expect(getOverlayStatus("responding", "connected")).toBe("speaking");
  });

  it("maps processing phase to 'processing'", () => {
    expect(getOverlayStatus("processing", "connected")).toBe("processing");
  });

  it("maps listening phase to 'listening'", () => {
    expect(getOverlayStatus("listening", "connected")).toBe("listening");
  });

  it("maps error phase to 'error'", () => {
    expect(getOverlayStatus("error", "connected")).toBe("error");
  });

  it("deepgram 'connecting' takes priority over listening phase", () => {
    expect(getOverlayStatus("listening", "connecting")).toBe("connecting");
  });

  it("deepgram 'connected' shows when phase is idle", () => {
    expect(getOverlayStatus("idle", "connected")).toBe("connected");
  });

  it("error phase takes priority over deepgram connecting", () => {
    expect(getOverlayStatus("error", "connecting")).toBe("error");
  });

  it("responding phase takes priority over deepgram connected", () => {
    expect(getOverlayStatus("responding", "connected")).toBe("speaking");
  });
});

describe("STATUS_CONFIG labels", () => {
  it("'idle' shows 'Standby'", () => {
    expect(STATUS_CONFIG.idle.label).toBe("Standby");
  });

  it("'speaking' shows 'Speaking' — displayed during TTS audio playback", () => {
    expect(STATUS_CONFIG.speaking.label).toBe("Speaking");
  });

  it("'processing' shows 'Thinking...'", () => {
    expect(STATUS_CONFIG.processing.label).toBe("Thinking...");
  });

  it("'listening' shows 'Listening...'", () => {
    expect(STATUS_CONFIG.listening.label).toBe("Listening...");
  });

  it("every OverlayStatus has a config entry", () => {
    const allStatuses: OverlayStatus[] = [
      "idle",
      "connecting",
      "connected",
      "listening",
      "processing",
      "speaking",
      "error",
    ];
    for (const status of allStatuses) {
      expect(STATUS_CONFIG[status]).toBeDefined();
      expect(STATUS_CONFIG[status].label).toBeTruthy();
      expect(STATUS_CONFIG[status].color).toBeTruthy();
    }
  });
});

describe("conversation phase → overlay label chain (Standby fix)", () => {
  const cases: Array<{
    scenario: string;
    phase: ConversationPhase;
    deepgramStatus: string;
    expectedLabel: string;
  }> = [
    {
      scenario: "initial load — no mic, no connection",
      phase: "idle",
      deepgramStatus: "idle",
      expectedLabel: "Standby",
    },
    {
      scenario: "mic clicked, deepgram connecting",
      phase: "idle",
      deepgramStatus: "connecting",
      expectedLabel: "Connecting...",
    },
    {
      scenario: "deepgram connected, waiting for speech",
      phase: "listening",
      deepgramStatus: "connected",
      expectedLabel: "Listening...",
    },
    {
      scenario: "user spoke, sending to LLM",
      phase: "processing",
      deepgramStatus: "connected",
      expectedLabel: "Thinking...",
    },
    {
      scenario: "LLM streaming + TTS audio playing",
      phase: "responding",
      deepgramStatus: "connected",
      expectedLabel: "Speaking",
    },
    {
      scenario: "TTS finished, back to listening",
      phase: "listening",
      deepgramStatus: "connected",
      expectedLabel: "Listening...",
    },
    {
      scenario: "error occurred",
      phase: "error",
      deepgramStatus: "connected",
      expectedLabel: "Error",
    },
  ];

  for (const { scenario, phase, deepgramStatus, expectedLabel } of cases) {
    it(`${scenario} → "${expectedLabel}"`, () => {
      const overlayStatus = getOverlayStatus(phase, deepgramStatus);
      const label = STATUS_CONFIG[overlayStatus].label;
      expect(label).toBe(expectedLabel);
    });
  }
});
