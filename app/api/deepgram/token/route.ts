import { NextResponse } from "next/server";

export async function POST() {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Deepgram API key not configured" },
        { status: 503 }
      );
    }

    // For the PoC, return the API key directly for client-side WebSocket.
    // In production, use Deepgram's /v1/manage/keys endpoint to create
    // a short-lived scoped key with limited permissions.
    return NextResponse.json({ key: apiKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate Deepgram token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
