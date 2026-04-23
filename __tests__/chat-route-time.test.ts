// Each hour-window branch in timeContextLine is exercised here by
// freezing `Intl.DateTimeFormat` to return a specific hour. One test
// per window — kept in its own file so vi.stubGlobal("Intl", ...) can't
// leak into the rest of the suite.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Lightweight mocks so the chat route runs without touching OpenAI.
vi.mock("@/lib/catalog", () => ({
  getAllProducts: () => [
    {
      id: "x",
      name: "X",
      display_name: "X",
      price: 1,
      search_keywords: [],
      sizes: [],
      customizations: [],
    },
  ],
}));

const createSpy = vi.fn(async () => ({
  [Symbol.asyncIterator]: async function* () {
    yield { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] };
  },
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createSpy } };
  },
}));

import { POST } from "@/app/api/chat/route";

function freezeHour(hour: number) {
  const str = String(hour).padStart(2, "0");
  class FakeDTF {
    format() {
      return str;
    }
  }
  vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: FakeDTF });
}

function makeRequest() {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "hi" }],
      cartContext: [],
    }),
  });
}

beforeEach(() => {
  createSpy.mockClear();
  vi.stubEnv("OPENAI_API_KEY", "sk-t");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/api/chat — timeContextLine branches", () => {
  it("renders 'Morning' at 08:00 PT", async () => {
    freezeHour(8);
    await POST(makeRequest());
    const sys = (createSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    }).messages[0].content;
    expect(sys).toContain("Morning");
  });

  it("renders 'Midday' at 12:00 PT", async () => {
    freezeHour(12);
    await POST(makeRequest());
    const sys = (createSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    }).messages[0].content;
    expect(sys).toContain("Midday");
  });

  it("renders 'Afternoon' at 16:00 PT", async () => {
    freezeHour(16);
    await POST(makeRequest());
    const sys = (createSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    }).messages[0].content;
    expect(sys).toContain("Afternoon");
  });

  it("renders 'Evening' at 21:00 PT", async () => {
    freezeHour(21);
    await POST(makeRequest());
    const sys = (createSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    }).messages[0].content;
    expect(sys).toContain("Evening");
  });
});
