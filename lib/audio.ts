type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedCtx: AudioContext | null = null;

// One AudioContext shared by TTS playback, VAD analysis, and Deepgram
// capture. iOS Safari routes audio output differently per AudioContext
// and tends to suspend or silence older contexts when a newer one is
// created. A single shared context sidesteps that whole category of bug.
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    const w = window as WebkitAudioWindow;
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

export async function resumeSharedAudioContext(): Promise<AudioContextState | null> {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (err) {
      console.warn("[audio] ctx.resume() rejected:", err);
    }
  }
  return ctx.state;
}
