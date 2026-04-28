// Demo-control phrases detected from the user's speech. Distinct from
// lib/finalize.ts (which decides when to close the order) — this module
// handles the "investor pitch" trigger. On 2026-04-28 (demo eve) Temur
// finalised the canonical phrase: "Walletta, what is your mission?"
// Saying it hands control to Tavus's conversation.echo so the replica
// reads PITCH_TEXT verbatim with native lip-sync, bypassing the persona
// LLM (deterministic word-for-word delivery, no paraphrase risk).
//
// We match BOTH the contracted ("what's your mission") and expanded
// ("what is your mission") forms with no name prefix required, so:
//   - "Walletta, what is your mission?" (Temur's canonical)         ✓
//   - "what's your mission" (Yasser's iPad smoke-test 2026-04-28)   ✓
//   - "Walleta what's your mission" (single-l STT fumble)           ✓
// Without the bare-question variant, dropping the name on stage
// silently falls through to the persona LLM ("my mission is to help
// with your order smoothly") which is exactly what Yasser hit during
// smoke-testing.
//
// False-positive risk is bounded: this is a coffee-ordering kiosk;
// nobody asks "what's your mission" while ordering a matcha. And the
// pitch is one-shot per session (isPitchingRef guards re-entry).
//
// normalize() collapses .,?! to spaces in addition to whitespace so
// real Deepgram output ("Walletta, what is your mission?") matches the
// punctuation-free phrase list with one substring check.

const PRESENT_PHRASES = [
  "what is your mission",
  "what's your mission",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[,.?!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPresentCompanySpeech(userText: string): boolean {
  const lower = normalize(userText);
  if (!lower) return false;
  return PRESENT_PHRASES.some((p) => lower.includes(p));
}
