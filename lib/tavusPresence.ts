// Shared "is the avatar audibly speaking right now?" flag.
//
// Used by useConversation to suppress our Deepgram → /api/chat pipeline
// while Tavus's avatar voice is in the room. Without this, iPad Safari's
// echo cancellation is too weak to prevent the mic from hearing the
// avatar through the iPad speakers, which means Deepgram transcribes
// the avatar's OWN voice ("I added an Americano") and pipes it back
// into /api/chat — the LLM then re-adds phantom items and the cart
// desyncs from what the avatar just said.
//
// The signal: Tavus's webhook publishes a stream of `transcript` events
// with `role: "replica"` while the avatar is talking. Each arrival is
// a proof-of-life; we hold the flag `on` for a short window past the
// last event so single-clause utterances don't flicker the guard off
// mid-sentence.
//
// This is a module-level singleton by design — the flag is global
// application state, not per-component, and avoiding React state means
// zero re-render cost when the flag flips.

const DECAY_MS = 1500;

let speakingUntil = 0;

export function markAvatarSpeech(): void {
  speakingUntil = performance.now() + DECAY_MS;
}

export function isAvatarSpeaking(): boolean {
  return performance.now() < speakingUntil;
}

export function resetAvatarSpeech(): void {
  speakingUntil = 0;
}
