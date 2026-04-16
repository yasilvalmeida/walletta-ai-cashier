import { NextResponse } from "next/server";

interface TavusConversationRow {
  conversation_id: string;
  status?: string;
}

interface TavusListResponse {
  data?: TavusConversationRow[];
}

// POST /api/tavus/cleanup — one-shot helper that lists every active
// Tavus conversation for the current API key and calls the "end"
// endpoint on each. Useful for recovering from
// "User has reached maximum concurrent conversations" 400s.
export async function POST() {
  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Tavus API key not configured" },
      { status: 503 }
    );
  }

  const listRes = await fetch("https://tavusapi.com/v2/conversations", {
    headers: { "x-api-key": apiKey },
  });
  if (!listRes.ok) {
    const text = await listRes.text();
    return NextResponse.json(
      { error: `Tavus list failed: ${listRes.status} ${text}` },
      { status: listRes.status }
    );
  }
  const list = (await listRes.json()) as TavusListResponse;
  const ids = (list.data ?? [])
    .filter((c) => c.status !== "ended")
    .map((c) => c.conversation_id);

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(
          `https://tavusapi.com/v2/conversations/${encodeURIComponent(id)}/end`,
          { method: "POST", headers: { "x-api-key": apiKey } }
        );
        return { id, ok: res.ok, status: res.status };
      } catch (err) {
        return { id, ok: false, error: String(err) };
      }
    })
  );

  return NextResponse.json({
    scanned: (list.data ?? []).length,
    ended: results.filter((r) => r.ok).length,
    details: results,
  });
}
