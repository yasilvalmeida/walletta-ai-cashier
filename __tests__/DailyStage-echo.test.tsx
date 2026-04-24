// @vitest-environment happy-dom
//
// Covers DailyStage's imperative handle for the investor-pitch flow.
// Asserts that sendEcho / sendInterrupt produce the exact Tavus
// Interactions Protocol app-message payload expected on the Daily
// data channel, and that replica-stopped-speaking events from Tavus
// fan out to subscribers registered via onReplicaStoppedSpeaking.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render } from "@testing-library/react";

// Mock daily-js: we capture the most recent call object so the test
// can read what was sent and simulate inbound app-message events.
interface MockCall {
  on: (ev: string, cb: (payload: unknown) => void) => void;
  sendAppMessage: ReturnType<typeof vi.fn>;
  listeners: Map<string, Array<(payload: unknown) => void>>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  emit: (ev: string, payload: unknown) => void;
}
let lastCall: MockCall | null = null;

function makeMockCall(): MockCall {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  const call: MockCall = {
    listeners,
    sendAppMessage: vi.fn(),
    on: (ev, cb) => {
      const arr = listeners.get(ev) ?? [];
      arr.push(cb);
      listeners.set(ev, arr);
    },
    join: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    destroy: vi.fn(),
    emit: (ev, payload) => {
      for (const cb of listeners.get(ev) ?? []) cb(payload);
    },
  };
  lastCall = call;
  return call;
}

vi.mock("@daily-co/daily-js", () => ({
  default: {
    createCallObject: () => makeMockCall(),
  },
}));

import {
  DailyStage,
  type DailyStageHandle,
} from "@/components/avatar/DailyStage";

beforeEach(() => {
  lastCall = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountReady() {
  const ref = createRef<DailyStageHandle>();
  render(
    <DailyStage
      ref={ref}
      conversationUrl="https://tavus.daily.co/demo"
      conversationId="conv-abc"
      status="ready"
      errorMessage={null}
      visible
      onReady={() => {}}
      onRetry={() => {}}
    />
  );
  // Let the setup effect register the call object.
  await new Promise((r) => setTimeout(r, 10));
  return ref;
}

describe("DailyStage imperative handle", () => {
  it("sendEcho writes the Tavus conversation.echo payload to Daily", async () => {
    const ref = await mountReady();
    ref.current!.sendEcho("Hello investors.");
    expect(lastCall!.sendAppMessage).toHaveBeenCalledWith(
      {
        message_type: "conversation",
        event_type: "conversation.echo",
        conversation_id: "conv-abc",
        properties: { text: "Hello investors." },
      },
      "*"
    );
  });

  it("sendInterrupt writes the Tavus conversation.interrupt payload", async () => {
    const ref = await mountReady();
    ref.current!.sendInterrupt();
    expect(lastCall!.sendAppMessage).toHaveBeenCalledWith(
      {
        message_type: "conversation",
        event_type: "conversation.interrupt",
        conversation_id: "conv-abc",
        properties: {},
      },
      "*"
    );
  });

  it("sendEcho no-ops on empty/whitespace text (defensive)", async () => {
    const ref = await mountReady();
    ref.current!.sendEcho("   ");
    expect(lastCall!.sendAppMessage).not.toHaveBeenCalled();
  });

  it("onReplicaStoppedSpeaking fans out inbound Tavus events to subscribers", async () => {
    const ref = await mountReady();
    const cb = vi.fn();
    const unsub = ref.current!.onReplicaStoppedSpeaking(cb);
    lastCall!.emit("app-message", {
      data: {
        message_type: "conversation",
        event_type: "replica-stopped-speaking",
        conversation_id: "conv-abc",
      },
    });
    expect(cb).toHaveBeenCalledTimes(1);
    // Events for a different conversation id must be filtered out.
    lastCall!.emit("app-message", {
      data: {
        message_type: "conversation",
        event_type: "replica-stopped-speaking",
        conversation_id: "conv-stale",
      },
    });
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    lastCall!.emit("app-message", {
      data: {
        message_type: "conversation",
        event_type: "replica-stopped-speaking",
        conversation_id: "conv-abc",
      },
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unrelated app-messages do not notify subscribers", async () => {
    const ref = await mountReady();
    const cb = vi.fn();
    ref.current!.onReplicaStoppedSpeaking(cb);
    lastCall!.emit("app-message", {
      data: {
        message_type: "conversation",
        event_type: "utterance",
        conversation_id: "conv-abc",
      },
    });
    lastCall!.emit("app-message", {
      data: { some: "other" },
    });
    expect(cb).not.toHaveBeenCalled();
  });
});
