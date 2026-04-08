import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { roomName, participantName } = (await request.json()) as {
      roomName: string;
      participantName: string;
    };

    if (!roomName || !participantName) {
      return NextResponse.json(
        { error: "roomName and participantName are required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json(
        { error: "LiveKit credentials not configured" },
        { status: 503 }
      );
    }

    // Token generation requires livekit-server-sdk (server-side only)
    // Placeholder: return config acknowledgment until SDK is added
    return NextResponse.json({
      token: "",
      url: livekitUrl,
      message: "LiveKit server SDK required for token generation",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate LiveKit token" },
      { status: 500 }
    );
  }
}
