import { describe, it, expect, vi, afterEach } from "vitest";
import { isDebugEnabled, formatDelta } from "@/lib/telemetry";
import type { Turn } from "@/lib/telemetry";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isDebugEnabled", () => {
  it("returns false in non-browser environments", () => {
    vi.stubGlobal("window", undefined);
    expect(isDebugEnabled()).toBe(false);
  });

  it.each([
    ["?debug=1", true],
    ["?debug=true", true],
    ["?debug=latency", true],
    ["?debug=yes", false],
    ["", false],
  ])("returns the right flag for %s", (search, want) => {
    vi.stubGlobal("window", { location: { search } });
    expect(isDebugEnabled()).toBe(want);
  });
});

describe("formatDelta", () => {
  const turn: Turn = {
    id: 1,
    startedAt: 0,
    marks: {
      speechStart: 0,
      sttFinal: 500,
      llmFirstToken: 900,
    },
  } as Turn;

  it("returns the delta between two marks", () => {
    expect(formatDelta(turn, "speechStart", "sttFinal")).toBe(500);
    expect(formatDelta(turn, "speechStart", "llmFirstToken")).toBe(900);
  });

  it("returns null if either mark is missing", () => {
    expect(formatDelta(turn, "speechStart", "audioFirstPlay")).toBeNull();
    expect(formatDelta(turn, "speechEnd", "sttFinal")).toBeNull();
  });

  it("clamps negative deltas to 0 (reordered marks edge case)", () => {
    expect(formatDelta(turn, "sttFinal", "speechStart")).toBe(0);
  });
});
