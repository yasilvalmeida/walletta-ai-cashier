import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

interface TokenRequest {
  roomName: string;
  participantName: string;
}

export async function POST(request: Request) {
  try {
    const { roomName, participantName } = (await request.json()) as TokenRequest;

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

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
      ttl: "10m",
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({ token, url: livekitUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate LiveKit token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
