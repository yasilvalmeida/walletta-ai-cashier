// Isolated file so we can import the REAL telemetry (no vi.doMock leak).
import { describe, it, expect } from "vitest";
import { perceivedLatency, type Turn } from "@/lib/telemetry";

const base = { id: 1, startedAt: 0 } as Omit<Turn, "marks">;

describe("perceivedLatency", () => {
  it("returns null when speechEnd is missing", () => {
    expect(perceivedLatency({ ...base, marks: {} } as Turn)).toBeNull();
  });

  it("returns null when no downstream mark is set", () => {
    expect(
      perceivedLatency({ ...base, marks: { speechEnd: 100 } } as Turn)
    ).toBeNull();
  });

  it("prefers fillerFirstPlay → audioFirstPlay → llmFirstToken (in that order)", () => {
    expect(
      perceivedLatency({
        ...base,
        marks: { speechEnd: 100, llmFirstToken: 600 },
      } as Turn)
    ).toBe(500);
    expect(
      perceivedLatency({
        ...base,
        marks: { speechEnd: 100, audioFirstPlay: 300, llmFirstToken: 600 },
      } as Turn)
    ).toBe(200);
    expect(
      perceivedLatency({
        ...base,
        marks: {
          speechEnd: 100,
          fillerFirstPlay: 120,
          audioFirstPlay: 300,
          llmFirstToken: 600,
        },
      } as Turn)
    ).toBe(20);
  });

  it("clamps negative deltas to 0", () => {
    expect(
      perceivedLatency({
        ...base,
        marks: { speechEnd: 600, llmFirstToken: 100 },
      } as Turn)
    ).toBe(0);
  });
});
