// Recovery helper for Tavus's concurrent-conversation cap.
//
// The free tier caps simultaneous conversations low (3 at time of
// writing). A dev loop that reloads the page faster than Tavus's
// backend retires sessions will trip "User has reached maximum
// concurrent conversations" 400s on the next /conversations POST —
// the beforeunload beacon on the client is best-effort and doesn't
// survive crashes or fast refresh.
//
// This module centralises the list→end fan-out so both /api/tavus/session
// (pre-emptively, on 400 retry) and /api/tavus/cleanup (manual reset)
// use the exact same logic. Pagination defaults to limit=100 so an
// active conversation hiding past page 1 can't silently block a retry.

interface TavusConversationRow {
  conversation_id: string;
  status?: string;
}

interface TavusListResponse {
  data?: TavusConversationRow[];
}

export interface EndAllResult {
  scanned: number;
  ended: number;
  details: Array<{ id: string; ok: boolean; status?: number; error?: string }>;
}

export async function endAllActiveConversations(
  apiKey: string
): Promise<EndAllResult> {
  const listRes = await fetch(
    "https://tavusapi.com/v2/conversations?limit=100",
    { headers: { "x-api-key": apiKey } }
  );
  if (!listRes.ok) {
    return { scanned: 0, ended: 0, details: [] };
  }
  const list = (await listRes.json()) as TavusListResponse;
  const rows = list.data ?? [];
  const ids = rows
    .filter((c) => (c.status ?? "").toLowerCase() !== "ended")
    .map((c) => c.conversation_id);

  const details = await Promise.all(
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

  return {
    scanned: rows.length,
    ended: details.filter((d) => d.ok).length,
    details,
  };
}

export function isMaxConcurrentError(status: number, text: string): boolean {
  if (status !== 400) return false;
  return /maximum\s+concurrent\s+conversations/i.test(text);
}
