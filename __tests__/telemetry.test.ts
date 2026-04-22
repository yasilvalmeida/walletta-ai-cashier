import { describe, it, expect, beforeEach, vi } from "vitest";
import { telemetry, perceivedLatency } from "@/lib/telemetry";

function setNow(value: number): void {
  vi.spyOn(performance, "now").mockReturnValue(value);
}

describe("telemetry bus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    telemetry.reset();
  });

  it("ensureTurn starts a turn lazily and only once", () => {
    setNow(1000);
    telemetry.mark("speechEnd");
    const t1 = telemetry.currentTurn();
    expect(t1).not.toBeNull();
    setNow(1100);
    telemetry.mark("sttFinal");
    const t2 = telemetry.currentTurn();
    expect(t2?.id).toBe(t1?.id);
  });

  it("mark records the first observation only (idempotent)", () => {
    setNow(2000);
    telemetry.mark("llmFirstToken");
    setNow(2500);
    telemetry.mark("llmFirstToken");
    const t = telemetry.currentTurn();
    expect(t?.marks.llmFirstToken).toBe(2000);
  });

  it("setMode updates the current turn without creating a new one", () => {
    setNow(3000);
    telemetry.mark("speechEnd");
    telemetry.setMode("tavus");
    expect(telemetry.currentTurn()?.mode).toBe("tavus");
  });

  it("endTurn moves the turn into history and resets current", () => {
    setNow(4000);
    telemetry.mark("speechEnd");
    telemetry.endTurn();
    expect(telemetry.currentTurn()).toBeNull();
    const hist = telemetry.snapshot();
    expect(hist[hist.length - 1]?.marks.speechEnd).toBe(4000);
  });

  it("perceivedLatency prefers fillerFirstPlay (Temur's sub-400ms target)", () => {
    setNow(4500);
    telemetry.mark("speechEnd");
    setNow(4550);
    telemetry.mark("fillerFirstPlay");
    setNow(5500);
    telemetry.mark("audioFirstPlay");
    const t = telemetry.currentTurn()!;
    expect(perceivedLatency(t)).toBe(50);
  });

  it("perceivedLatency uses audioFirstPlay when available", () => {
    setNow(5000);
    telemetry.mark("speechEnd");
    setNow(5400);
    telemetry.mark("audioFirstPlay");
    const t = telemetry.currentTurn()!;
    expect(perceivedLatency(t)).toBe(400);
  });

  it("perceivedLatency falls back to llmFirstToken in Tavus mode (no audio)", () => {
    setNow(6000);
    telemetry.mark("speechEnd");
    setNow(6350);
    telemetry.mark("llmFirstToken");
    const t = telemetry.currentTurn()!;
    expect(perceivedLatency(t)).toBe(350);
  });

  it("perceivedLatency is null when no terminal mark has arrived", () => {
    setNow(7000);
    telemetry.mark("speechEnd");
    const t = telemetry.currentTurn()!;
    expect(perceivedLatency(t)).toBeNull();
  });

  it("subscribers receive each completed turn", () => {
    const seen: number[] = [];
    const unsub = telemetry.subscribe((t) => seen.push(t.id));
    setNow(8000);
    telemetry.mark("speechEnd");
    telemetry.endTurn();
    setNow(9000);
    telemetry.mark("speechEnd");
    telemetry.endTurn();
    unsub();
    expect(seen.length).toBe(2);
    expect(seen[1]).toBe(seen[0] + 1);
  });
});
