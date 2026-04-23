import { describe, it, expect, vi, beforeEach } from "vitest";
import { endAllActiveConversations } from "@/lib/tavus";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("lib/tavus.endAllActiveConversations — list response edge cases", () => {
  it("treats missing `data` array as no active conversations", async () => {
    // Tavus has historically wrapped the list in `{}` with no `data`
    // when the account has zero conversations — the helper must cope
    // with that without throwing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );
    const result = await endAllActiveConversations("tk");
    expect(result).toEqual({ scanned: 0, ended: 0, details: [] });
  });

  it("skips rows whose status is literally 'ended' (case-insensitive)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { conversation_id: "a", status: "ENDED" },
              { conversation_id: "b", status: "Ended" },
              { conversation_id: "c", status: "active" },
            ],
          }),
          { status: 200 }
        )
      )
    );
    const result = await endAllActiveConversations("tk");
    expect(result.scanned).toBe(3);
    // Only "c" is non-ended; the two mixed-case "ended" rows are
    // filtered out at the status-check branch.
    expect(result.details).toHaveLength(1);
    expect(result.details[0].id).toBe("c");
  });
});
