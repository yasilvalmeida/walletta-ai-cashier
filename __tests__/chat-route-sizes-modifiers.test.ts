// Exercises lines 82-94 of app/api/chat/route.ts — the sizes and
// modifiers rendering branches in formatProductForPrompt. We do NOT
// mock @/lib/catalog here: the real data/products.json carries at
// least one product (Americano) with both sizes and customizations, so
// letting the real catalog load is the cleanest path to hit both
// branches. OpenAI is still mocked so no network call fires.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

beforeEach(() => {
  createSpy.mockClear();
  vi.stubEnv("OPENAI_API_KEY", "sk-t");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/chat — product catalog rendering with sizes + modifiers (real catalog)", () => {
  it("renders sizes and modifiers blocks for any product that has both", async () => {
    await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "what drinks?" }],
          cartContext: [],
        }),
      })
    );
    const sys = (createSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    }).messages[0].content;
    // Real catalog contains entries with both sizes and customizations
    // (e.g. Americano). The substring check is permissive — we just
    // care that both branches of formatProductForPrompt executed.
    expect(sys).toMatch(/sizes:/);
    expect(sys).toMatch(/modifiers:/);
  });

  it("also produces lines with NO sizes and NO modifiers (line 83/89 false arms)", async () => {
    await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "menu" }],
          cartContext: [],
        }),
      })
    );
    const sys = (createSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    }).messages[0].content;
    // At least one product line exists WITHOUT a "sizes:" or "modifiers:"
    // annotation — exercising the else arms of both ternaries.
    const productLines = sys
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const plainLines = productLines.filter(
      (l) => !l.includes("sizes:") && !l.includes("modifiers:")
    );
    expect(plainLines.length).toBeGreaterThan(0);
  });
});
