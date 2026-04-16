import { NextResponse } from "next/server";

interface EndRequestBody {
  conversationId?: string;
}

export async function POST(request: Request) {
  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Tavus API key not configured" },
      { status: 503 }
    );
  }

  let body: EndRequestBody;
  try {
    body = (await request.json()) as EndRequestBody;
  } catch {
    body = {};
  }

  const conversationId = body.conversationId;
  if (!conversationId) {
    return NextResponse.json(
      { error: "Missing conversationId" },
      { status: 400 }
    );
  }

  // Tavus end-conversation endpoint. We fire-and-forget: even if Tavus
  // returns an error (e.g. already ended), callers should not block the
  // UI on this cleanup.
  const response = await fetch(
    `https://tavusapi.com/v2/conversations/${encodeURIComponent(
      conversationId
    )}/end`,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: `Tavus end failed: ${response.status} ${errorText}` },
      { status: response.status }
    );
  }

  return NextResponse.json({ ok: true });
}
