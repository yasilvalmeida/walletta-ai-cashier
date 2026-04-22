import { describe, it, expect } from "vitest";
import { FILLERS, fillersFor, pickFiller } from "@/lib/fillers";

describe("fillers", () => {
  it("returns English fillers for an unknown language code", () => {
    expect(fillersFor("xx")).toBe(FILLERS.en);
  });

  it("returns English fillers when language is undefined", () => {
    expect(fillersFor(undefined)).toBe(FILLERS.en);
  });

  it("returns Spanish fillers for 'es'", () => {
    expect(fillersFor("es")).toBe(FILLERS.es);
  });

  it("pickFiller always returns a member of the language's phrase set", () => {
    for (let i = 0; i < 50; i++) {
      const phrase = pickFiller("en");
      expect(FILLERS.en).toContain(phrase);
    }
  });

  it("pickFiller for non-English returns that language's phrase", () => {
    for (let i = 0; i < 20; i++) {
      const phrase = pickFiller("zh");
      expect(FILLERS.zh).toContain(phrase);
    }
  });

  it("every configured language has at least one filler", () => {
    for (const [lang, phrases] of Object.entries(FILLERS)) {
      expect(phrases.length, `language ${lang} must have filler phrases`).toBeGreaterThan(0);
      for (const phrase of phrases) {
        expect(phrase.trim().length, `filler in ${lang} must not be empty`).toBeGreaterThan(0);
      }
    }
  });
});
