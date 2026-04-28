import { describe, it, expect } from "vitest";
import { isPresentCompanySpeech } from "@/lib/commands";
import { isFinalizeSpeech } from "@/lib/finalize";

describe("isPresentCompanySpeech", () => {
  it("matches the canonical demo trigger with full punctuation", () => {
    // Real Deepgram output for the trigger Temur uses on demo day.
    expect(isPresentCompanySpeech("Walletta, what is your mission?")).toBe(
      true
    );
  });

  it("matches the bare question without the name prefix", () => {
    // The on-stage flub: Temur drops "Walletta" or Deepgram mangles it.
    // Without this variant the persona LLM answers naturally and the
    // pitch silently fails (Yasser's iPad smoke-test 2026-04-28).
    expect(isPresentCompanySpeech("what is your mission")).toBe(true);
    expect(isPresentCompanySpeech("what's your mission")).toBe(true);
    expect(isPresentCompanySpeech("What's your mission?")).toBe(true);
  });

  it("matches when punctuation is dropped (iOS dictation, accent paths)", () => {
    expect(isPresentCompanySpeech("walletta what is your mission")).toBe(true);
    expect(isPresentCompanySpeech("Walletta what is your mission")).toBe(true);
  });

  it("is case-insensitive and tolerates whitespace runs", () => {
    expect(isPresentCompanySpeech("  WALLETTA, WHAT IS YOUR MISSION?  ")).toBe(
      true
    );
    expect(isPresentCompanySpeech("Walletta,  what  is   your  mission")).toBe(
      true
    );
  });

  it("matches when embedded in a longer utterance", () => {
    // iPad dictation tends to add filler; the trigger should still fire.
    expect(
      isPresentCompanySpeech("okay Walletta, what is your mission today")
    ).toBe(true);
  });

  it("does not match unrelated speech", () => {
    expect(isPresentCompanySpeech("")).toBe(false);
    expect(isPresentCompanySpeech("what's on the menu")).toBe(false);
    expect(isPresentCompanySpeech("I'd like a matcha")).toBe(false);
    expect(isPresentCompanySpeech("that's all")).toBe(false);
    // The previous phrase set is intentionally retired — these MUST
    // no longer trigger the pitch (locks the new contract in place).
    expect(isPresentCompanySpeech("present the company")).toBe(false);
    expect(isPresentCompanySpeech("pitch Walletta")).toBe(false);
    expect(isPresentCompanySpeech("investor pitch")).toBe(false);
  });

  it("does not collide with finalize triggers", () => {
    // The pitch trigger must NOT inadvertently also finalize the order.
    expect(isFinalizeSpeech("Walletta, what is your mission?")).toBe(false);
    expect(isPresentCompanySpeech("Walletta, what is your mission?")).toBe(
      true
    );
  });
});
