// Investor-pitch script sent to Tavus via conversation.echo when the
// customer (or Temur, during the Startup Grind demo) says "Present the
// company". The replica reads this text verbatim with native lip-sync —
// the persona LLM is NOT consulted, so the exact wording Temur writes
// here is exactly what investors hear.
//
// Kept as a single-source-of-truth constant so the only Monday-morning
// edit is a text swap. The orchestration in CashierApp guards on
// hasPitchText() first, so shipping this file with an empty string is
// safe — the trigger is a silent no-op until content is filled in.
//
// Constraints for the text (from Tavus Interactions Protocol docs +
// empirical testing):
//   - ≤ ~1500 characters reliably; split across two echoes if longer.
//   - Plain punctuation (. , ? !) — Cartesia Sonic-2 handles these.
//   - Avoid em-dashes and ellipses (inconsistent pauses).
//   - ~150 wpm ≈ 150 words ≈ 900 chars for a 60s pitch.

export const PITCH_TEXT: string =
  "For decades, global commerce has relied on hundreds of millions of people to do a machine's job. That era ends today. I am Walletta. By taking over the checkout experience, we are fundamentally upgrading how the world operates. Our roadmap is clear: to deploy one million avatars like me in the next five to ten years. No breaks, no errors, just absolute precision. We are building the ultimate infrastructure for tomorrow's retail. The shift is happening right now, in front of your eyes.";

// Safety fallback: if Tavus never emits `replica-stopped-speaking`
// (e.g. transient Daily disconnect), unfreeze the idle timer and clear
// the pitch guard after this many ms. Sized above the longest plausible
// ~60s pitch to avoid tripping mid-speech.
export const PITCH_DURATION_MS = 90_000;

export function hasPitchText(): boolean {
  return PITCH_TEXT.trim().length > 0;
}
