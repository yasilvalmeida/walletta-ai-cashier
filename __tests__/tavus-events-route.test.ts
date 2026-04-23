import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/tavus/events/route";
import { publishEvent, clearConversation } from "@/lib/tavusEvents";

function makeRequest(qs = ""): Request {
  return new Request(`http://localhost/api/tavus/events${qs}`, {
    method: "GET",
  });
}

beforeEach(() => {
  clearConversation("conv-evt-test");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function readFirstEvent(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let acc = "";
  const decoder = new TextDecoder();
  // Pull up to 3 chunks — the first is the ": connected" comment line,
  // then the data: payload comes after we publish.
  for (let i = 0; i < 3; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) acc += decoder.decode(value, { stream: true });
    if (acc.includes("data:")) break;
  }
  reader.releaseLock();
  return acc;
}

describe("/api/tavus/events", () => {
  it("returns 400 when conversationId is missing", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
  });

  it("opens an SSE stream with the expected headers", async () => {
    const res = await GET(makeRequest("?conversationId=conv-evt-test"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    // Cancel the stream so the pinging interval doesn't keep the test
    // process alive past the assertion.
    await res.body?.cancel();
  });

  it("delivers published events to the open SSE connection", async () => {
    const res = await GET(makeRequest("?conversationId=conv-evt-test"));
    expect(res.body).not.toBeNull();
    const received = readFirstEvent(res.body!);
    publishEvent({
      kind: "finalize",
      conversationId: "conv-evt-test",
      timestamp: Date.now(),
    });
    const payload = await received;
    expect(payload).toContain(": connected conv-evt-test");
    expect(payload).toMatch(/data: \{.*"kind":"finalize"/);
    await res.body?.cancel();
  });
});
