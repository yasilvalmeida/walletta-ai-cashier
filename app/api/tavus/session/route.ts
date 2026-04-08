import { NextResponse } from "next/server";

export async function POST() {
  try {
    const apiKey = process.env.TAVUS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Tavus API key not configured" },
        { status: 503 }
      );
    }

    // Create a Tavus conversation session
    const response = await fetch("https://tavusapi.com/v2/conversations", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // replica_id and persona_id will be configured later
        properties: {
          max_call_duration: 600,
          enable_recording: false,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Tavus API error: ${error}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as {
      conversation_id: string;
      conversation_url: string;
    };

    return NextResponse.json({
      conversationId: data.conversation_id,
      conversationUrl: data.conversation_url,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to create Tavus session" },
      { status: 500 }
    );
  }
}
