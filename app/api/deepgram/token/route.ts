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

    // In production, create a short-lived ephemeral key via Deepgram API
    // For now, return the API key status
    return NextResponse.json({
      key: "",
      message: "Deepgram ephemeral key endpoint ready — needs API key",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate Deepgram token" },
      { status: 500 }
    );
  }
}
