// Short acknowledgment phrases pre-synthesized via Cartesia on page
// mount and stashed as decoded ArrayBuffers. On speech-end we play one
// within ~50ms so the customer perceives an instant reply even while
// GPT-4o is still computing its first token. The real LLM response
// queues behind the filler and plays when it's ready.
//
// Kept deliberately short (one word / two syllables) so the filler
// finishes before the real response typically needs to start — a
// longer filler creates an awkward gap at the tail when the LLM
// returns quickly.
//
// Note: fillers are Cartesia-mode only. In Tavus mode the avatar owns
// the voice and a separate Cartesia filler would double-audio with it.

// Phrases tuned for audio-duration < ~700 ms when synthesized by
// Cartesia Sonic-2 — measured Apr 22:
//   "Mm-hm." → 937 ms (dropped — too long, left a gap at the tail)
//   "One sec." → 845 ms
//   "Got it." → 612 ms (cleanest)
// Keeping 2 per language for variety; avoiding anything that implies
// a longer LLM wait than the filler itself actually covers.
export const FILLERS: Record<string, string[]> = {
  en: ["Got it.", "One sec."],
  es: ["Claro.", "Un momento."],
  zh: ["好的。", "稍等。"],
  fr: ["D'accord.", "Un instant."],
  de: ["Alles klar.", "Einen Moment."],
  ja: ["はい。", "少々お待ちを。"],
  ko: ["네.", "잠시만요."],
  pt: ["Certo.", "Um momento."],
  it: ["Certo.", "Un momento."],
};

export function fillersFor(language: string | undefined): string[] {
  if (!language) return FILLERS.en;
  return FILLERS[language] ?? FILLERS.en;
}

export function pickFiller(language: string | undefined): string {
  const set = fillersFor(language);
  return set[Math.floor(Math.random() * set.length)];
}
