// Demo-control phrases detected from the user's speech. Distinct from
// lib/finalize.ts (which decides when to close the order) — this module
// handles the "investor pitch" trigger Temur asked for on 2026-04-24:
// saying "Present the company" hands control to Tavus's conversation.echo
// so the replica reads a fixed pitch script verbatim with native
// lip-sync, bypassing the persona LLM.
//
// Matcher semantics match lib/finalize's permissive substring style
// (case-insensitive, tolerant of missing apostrophes) because iOS
// dictation and Deepgram multi-language mode both occasionally drop
// punctuation.

const PRESENT_PHRASES = [
  "present the company",
  "present walletta",
  "pitch walletta",
  "pitch the company",
  "give the pitch",
  "investor pitch",
  "tell them about walletta",
  "tell them about the company",
];

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export function isPresentCompanySpeech(userText: string): boolean {
  const lower = normalize(userText);
  if (!lower) return false;
  return PRESENT_PHRASES.some((p) => lower.includes(p));
}
