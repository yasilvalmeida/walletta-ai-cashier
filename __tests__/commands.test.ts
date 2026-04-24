import { describe, it, expect } from "vitest";
import { isPresentCompanySpeech } from "@/lib/commands";
import { isFinalizeSpeech } from "@/lib/finalize";

describe("isPresentCompanySpeech", () => {
  it("matches the canonical trigger and obvious variants", () => {
    expect(isPresentCompanySpeech("present the company")).toBe(true);
    expect(isPresentCompanySpeech("present Walletta")).toBe(true);
    expect(isPresentCompanySpeech("pitch Walletta")).toBe(true);
    expect(isPresentCompanySpeech("pitch the company")).toBe(true);
    expect(isPresentCompanySpeech("give the pitch")).toBe(true);
    expect(isPresentCompanySpeech("investor pitch")).toBe(true);
    expect(isPresentCompanySpeech("tell them about Walletta")).toBe(true);
    expect(isPresentCompanySpeech("tell them about the company")).toBe(true);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(isPresentCompanySpeech("  PRESENT THE COMPANY  ")).toBe(true);
    expect(isPresentCompanySpeech("Present  the   Company")).toBe(true);
  });

  it("matches when embedded in a longer utterance", () => {
    // iPad dictation tends to add filler; the trigger should still fire.
    expect(isPresentCompanySpeech("okay, present the company now")).toBe(true);
    expect(
      isPresentCompanySpeech("everyone, give the pitch please")
    ).toBe(true);
  });

  it("does not match unrelated speech", () => {
    expect(isPresentCompanySpeech("")).toBe(false);
    expect(isPresentCompanySpeech("what's on the menu")).toBe(false);
    expect(isPresentCompanySpeech("I'd like a matcha")).toBe(false);
    expect(isPresentCompanySpeech("that's all")).toBe(false);
  });

  it("does not collide with finalize triggers for the pitch variants", () => {
    // Pitch variants must NOT inadvertently also finalize the order.
    for (const phrase of [
      "present the company",
      "pitch Walletta",
      "investor pitch",
    ]) {
      expect(isFinalizeSpeech(phrase)).toBe(false);
      expect(isPresentCompanySpeech(phrase)).toBe(true);
    }
  });
});
