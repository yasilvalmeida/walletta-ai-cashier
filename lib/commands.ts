// Demo-control phrases detected from the user's speech. Distinct from
// lib/finalize.ts (which decides when to close the order) — this module
// handles the "investor pitch" trigger. On 2026-04-28 (demo eve) Temur
// finalised the canonical phrase: "Walletta, what is your mission?"
// Saying it hands control to Tavus's conversation.echo so the replica
// reads PITCH_TEXT verbatim with native lip-sync, bypassing the persona
// LLM (deterministic word-for-word delivery, no paraphrase risk).
//
// normalize() collapses .,?! to spaces in addition to whitespace so
// real Deepgram output ("Walletta, what is your mission?") matches the
// punctuation-free phrase list with one substring check. iOS dictation
// and accent paths drop punctuation inconsistently; one normalize step
// covers all variants without per-variant duplication.

const PRESENT_PHRASES = ["walletta what is your mission"];

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
