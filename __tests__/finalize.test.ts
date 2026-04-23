import { describe, it, expect } from "vitest";
import { isFinalizeSpeech, isPureFinalize } from "@/lib/finalize";

describe("isFinalizeSpeech (receipt-modal trigger)", () => {
  it("matches canonical closes", () => {
    expect(isFinalizeSpeech("that's all")).toBe(true);
    expect(isFinalizeSpeech("that is all")).toBe(true);
    expect(isFinalizeSpeech("checkout")).toBe(true);
    expect(isFinalizeSpeech("pay")).toBe(true);
    expect(isFinalizeSpeech("done")).toBe(true);
    expect(isFinalizeSpeech("I'm done")).toBe(true);
    expect(isFinalizeSpeech("I am done")).toBe(true);
  });

  it("accepts the apostrophe-free variants Deepgram/iOS sometimes emits", () => {
    expect(isFinalizeSpeech("thats all")).toBe(true);
    expect(isFinalizeSpeech("thats it")).toBe(true);
    expect(isFinalizeSpeech("im done")).toBe(true);
    expect(isFinalizeSpeech("im good")).toBe(true);
  });

  it("matches natural English closes beyond the literal keywords", () => {
    expect(isFinalizeSpeech("that's it")).toBe(true);
    expect(isFinalizeSpeech("all set")).toBe(true);
    expect(isFinalizeSpeech("no thanks")).toBe(true);
    expect(isFinalizeSpeech("no thank you")).toBe(true);
  });

  it("matches when the close is inside a longer utterance", () => {
    // Client-side path is permissive so "matcha, that's all" still
    // finalises once the cart has that matcha added earlier in the turn.
    expect(isFinalizeSpeech("yeah, that's all")).toBe(true);
    expect(isFinalizeSpeech("I'll take a matcha, that's all")).toBe(true);
    expect(isFinalizeSpeech("okay I am done")).toBe(true);
  });

  it("is case-insensitive and tolerant of whitespace", () => {
    expect(isFinalizeSpeech("  THAT'S ALL  ")).toBe(true);
    expect(isFinalizeSpeech("Checkout")).toBe(true);
  });

  it("does not match unrelated speech", () => {
    expect(isFinalizeSpeech("")).toBe(false);
    expect(isFinalizeSpeech("   ")).toBe(false);
    expect(isFinalizeSpeech("I'd like a matcha")).toBe(false);
    expect(isFinalizeSpeech("add a croissant")).toBe(false);
    // "done" must not match substrings like "doneness" — regex-free
    // substring matching catches this only for exact "done" / trailing
    // " done". Sanity-check the behaviour we rely on.
    expect(isFinalizeSpeech("doneness")).toBe(false);
  });
});

describe("isPureFinalize (server-side force-add suppression)", () => {
  it("matches only standalone closes", () => {
    expect(isPureFinalize("that's all")).toBe(true);
    expect(isPureFinalize("thats all")).toBe(true);
    expect(isPureFinalize("done")).toBe(true);
    expect(isPureFinalize("checkout")).toBe(true);
    expect(isPureFinalize("no, that's all.")).toBe(true);
    expect(isPureFinalize("no. that's all.")).toBe(true);
  });

  it("is strict — mixed utterances must NOT match so force-add still fires", () => {
    // If this returned true, "matcha, that's all" would skip the
    // forced add_to_cart and the cart would end up empty on checkout.
    expect(isPureFinalize("matcha, that's all")).toBe(false);
    expect(isPureFinalize("I'll take a matcha")).toBe(false);
    expect(isPureFinalize("an americano and that's all")).toBe(false);
  });

  it("normalises casing and extra whitespace", () => {
    expect(isPureFinalize("  That's All  ")).toBe(true);
    expect(isPureFinalize("THAT'S  ALL")).toBe(true);
  });
});
