import { NextResponse } from "next/server";
import { endAllActiveConversations } from "@/lib/tavus";

// POST /api/tavus/cleanup — one-shot helper that ends every active
// Tavus conversation for the current API key. Useful for recovering
// from "User has reached maximum concurrent conversations" 400s; the
// same helper is invoked automatically by /api/tavus/session on a
// retryable 400, so manual calls are only needed for debugging.
export async function POST() {
  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Tavus API key not configured" },
      { status: 503 }
    );
  }

  const result = await endAllActiveConversations(apiKey);
  return NextResponse.json(result);
}
