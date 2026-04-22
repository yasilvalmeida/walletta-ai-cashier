import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  markAvatarSpeech,
  isAvatarSpeaking,
  resetAvatarSpeech,
} from "@/lib/tavusPresence";

function setNow(value: number): void {
  vi.spyOn(performance, "now").mockReturnValue(value);
}

describe("tavusPresence echo guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAvatarSpeech();
  });

  it("isAvatarSpeaking is false before any replica event", () => {
    setNow(1000);
    expect(isAvatarSpeaking()).toBe(false);
  });

  it("markAvatarSpeech keeps the flag on for 1.5s past the last event", () => {
    setNow(1000);
    markAvatarSpeech();
    setNow(2000); // +1000ms from mark — still inside the 1.5s window
    expect(isAvatarSpeaking()).toBe(true);
    setNow(2600); // +1600ms — past the window
    expect(isAvatarSpeaking()).toBe(false);
  });

  it("consecutive marks extend the window from the last call", () => {
    setNow(1000);
    markAvatarSpeech();
    setNow(2400); // last mark was at 1000, window ends at 2500; still on
    expect(isAvatarSpeaking()).toBe(true);
    markAvatarSpeech(); // refreshed at 2400 → window now ends at 3900
    setNow(3800);
    expect(isAvatarSpeaking()).toBe(true);
    setNow(4000);
    expect(isAvatarSpeaking()).toBe(false);
  });

  it("resetAvatarSpeech force-clears the flag", () => {
    setNow(1000);
    markAvatarSpeech();
    expect(isAvatarSpeaking()).toBe(true);
    resetAvatarSpeech();
    expect(isAvatarSpeaking()).toBe(false);
  });
});
