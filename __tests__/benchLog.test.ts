import { describe, it, expect, beforeEach } from "vitest";
import { pushRun, listRuns, clearRuns } from "@/lib/benchLog";

beforeEach(() => {
  clearRuns();
});

const baseRun = {
  timestamp: 1700000000000,
  prompt: "hello",
  providers: [
    {
      provider: "openai" as const,
      model: "gpt-4o",
      ok: true,
      ttftMs: 450,
    },
  ],
};

describe("benchLog", () => {
  it("assigns incrementing ids starting from 1", () => {
    const a = pushRun(baseRun);
    const b = pushRun(baseRun);
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it("lists runs most-recent first", () => {
    pushRun({ ...baseRun, prompt: "first" });
    pushRun({ ...baseRun, prompt: "second" });
    const list = listRuns();
    expect(list).toHaveLength(2);
    expect(list[0].prompt).toBe("second");
    expect(list[1].prompt).toBe("first");
  });

  it("caps the ring buffer at 100 entries", () => {
    for (let i = 0; i < 105; i++) pushRun({ ...baseRun, prompt: `run-${i}` });
    const list = listRuns();
    expect(list).toHaveLength(100);
    // Oldest 5 should have been dropped; newest at index 0.
    expect(list[0].prompt).toBe("run-104");
    expect(list[list.length - 1].prompt).toBe("run-5");
  });

  it("clearRuns resets both the list and the sequence", () => {
    pushRun(baseRun);
    pushRun(baseRun);
    clearRuns();
    expect(listRuns()).toHaveLength(0);
    const fresh = pushRun(baseRun);
    expect(fresh.id).toBe(1);
  });
});
