import { describe, it, expect } from "vitest";
import { PITCH_TEXT, PITCH_DURATION_MS, hasPitchText } from "@/lib/pitch";

describe("lib/pitch", () => {
  it("PITCH_DURATION_MS is a positive number sized above a ~60s pitch", () => {
    expect(typeof PITCH_DURATION_MS).toBe("number");
    expect(PITCH_DURATION_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("PITCH_TEXT is populated with the canonical opener", () => {
    // Locked 2026-04-28: investors hear this on Tuesday. An accidental
    // wipe would let the trigger silently no-op (CashierApp short-
    // circuits via hasPitchText()) and the demo would just stall.
    expect(typeof PITCH_TEXT).toBe("string");
    expect(PITCH_TEXT).toContain("I am Walletta");
  });

  it("hasPitchText() mirrors whether PITCH_TEXT is non-whitespace", () => {
    expect(hasPitchText()).toBe(PITCH_TEXT.trim().length > 0);
  });

  it("if PITCH_TEXT is populated it stays within Tavus's reliable echo budget", () => {
    // Tavus conversation.echo works reliably up to ~1500 chars per call.
    // When Temur drops final text in, this guards against a too-long
    // single-echo pitch that would need splitting.
    if (PITCH_TEXT.trim().length > 0) {
      expect(PITCH_TEXT.length).toBeLessThanOrEqual(1500);
    }
  });
});
