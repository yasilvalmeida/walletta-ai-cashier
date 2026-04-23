import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The audio module caches a singleton AudioContext at module scope. We
// reload the module in each test via vi.resetModules so the cache is
// fresh — otherwise a previous test's stub leaks.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Build a fresh AudioContext mock for each test. The module invokes
// `new Ctor()`, so we need something newable — an arrow function fails.
function makeCtxStub(
  options: {
    state?: AudioContextState;
    resume?: () => Promise<void>;
    /** Lets us change the state after resume resolves. */
    postResumeState?: AudioContextState;
  } = {}
) {
  const instance = {
    state: options.state ?? "running",
    resume:
      options.resume ??
      (async () => {
        if (options.postResumeState) instance.state = options.postResumeState;
      }),
  };
  function Ctor(this: typeof instance) {
    Object.assign(this, instance);
  }
  return { Ctor: Ctor as unknown as { new (): AudioContext }, instance };
}

describe("getSharedAudioContext", () => {
  it("returns null in non-browser environments", async () => {
    vi.stubGlobal("window", undefined);
    const { getSharedAudioContext } = await import("@/lib/audio");
    expect(getSharedAudioContext()).toBeNull();
  });

  it("returns null when no AudioContext constructor exists", async () => {
    vi.stubGlobal("window", {});
    const { getSharedAudioContext } = await import("@/lib/audio");
    expect(getSharedAudioContext()).toBeNull();
  });

  it("constructs a context from window.AudioContext when available", async () => {
    const spy = vi.fn();
    class FakeCtx {
      state: AudioContextState = "running";
      constructor() {
        spy();
      }
    }
    vi.stubGlobal("window", { AudioContext: FakeCtx });
    const { getSharedAudioContext } = await import("@/lib/audio");
    const ctx = getSharedAudioContext();
    expect(ctx).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to webkitAudioContext for older Safari", async () => {
    const spy = vi.fn();
    class FakeCtx {
      state: AudioContextState = "running";
      constructor() {
        spy();
      }
    }
    vi.stubGlobal("window", { webkitAudioContext: FakeCtx });
    const { getSharedAudioContext } = await import("@/lib/audio");
    expect(getSharedAudioContext()).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns the same instance on subsequent calls", async () => {
    const spy = vi.fn();
    class FakeCtx {
      state: AudioContextState = "running";
      constructor() {
        spy();
      }
    }
    vi.stubGlobal("window", { AudioContext: FakeCtx });
    const { getSharedAudioContext } = await import("@/lib/audio");
    const first = getSharedAudioContext();
    const second = getSharedAudioContext();
    expect(first).toBe(second);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when the cached context is closed (iOS Safari edge case)", async () => {
    const spy = vi.fn();
    const states: AudioContextState[] = ["closed", "running"];
    class FakeCtx {
      state: AudioContextState;
      constructor() {
        this.state = states.shift() ?? "running";
        spy();
      }
    }
    vi.stubGlobal("window", { AudioContext: FakeCtx });
    const { getSharedAudioContext } = await import("@/lib/audio");
    getSharedAudioContext();
    getSharedAudioContext();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("resumeSharedAudioContext", () => {
  it("returns null when no context is available", async () => {
    vi.stubGlobal("window", undefined);
    const { resumeSharedAudioContext } = await import("@/lib/audio");
    await expect(resumeSharedAudioContext()).resolves.toBeNull();
  });

  it("resumes a suspended context and returns the post-resume state", async () => {
    class FakeCtx {
      state: AudioContextState = "suspended";
      async resume() {
        this.state = "running";
      }
    }
    vi.stubGlobal("window", { AudioContext: FakeCtx });
    const { resumeSharedAudioContext } = await import("@/lib/audio");
    const state = await resumeSharedAudioContext();
    expect(state).toBe("running");
  });

  it("returns the current state unchanged when not suspended", async () => {
    const resume = vi.fn(async () => {});
    class FakeCtx {
      state: AudioContextState = "running";
      resume = resume;
    }
    vi.stubGlobal("window", { AudioContext: FakeCtx });
    const { resumeSharedAudioContext } = await import("@/lib/audio");
    const state = await resumeSharedAudioContext();
    expect(resume).not.toHaveBeenCalled();
    expect(state).toBe("running");
  });

  it("swallows rejections from ctx.resume() (iOS user-gesture quirk)", async () => {
    class FakeCtx {
      state: AudioContextState = "suspended";
      async resume() {
        throw new Error("no gesture");
      }
    }
    vi.stubGlobal("window", { AudioContext: FakeCtx });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resumeSharedAudioContext } = await import("@/lib/audio");
    await expect(resumeSharedAudioContext()).resolves.toBe("suspended");
  });
});
