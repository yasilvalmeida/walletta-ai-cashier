import { NextResponse } from "next/server";

const TAVUS_API = "https://tavusapi.com/v2/conversations";
const DEFAULT_REPLICA_ID = "r5f0577fc829";
// Erewhon Cashier persona (no tools). Tavus delivers the full
// conversation transcript at session end via
// application.transcription_ready — we parse each user turn out of
// that and replay it through /api/chat to populate the cart. The
// tool-enabled variant (p8320500b2f2) seems to suppress user turns
// in the final transcript, so we stay on this one.
const DEFAULT_PERSONA_ID = "pe2d1f72ee4b";

const CONVERSATIONAL_CONTEXT = `You are Jordan, the Erewhon Market cashier AI. Warm, premium, and efficient. Help customers order smoothies, coffee & tonics, and pastries. Ask for cup sizes on coffee drinks, offer milk/shot/syrup modifiers, and pair a pastry with coffee orders when appropriate. Keep responses to two sentences max. Confirm each item as you add it.`;

interface TavusSessionResponse {
  conversation_id: string;
  conversation_url: string;
}

interface TavusConversationRequest {
  replica_id: string;
  conversation_name: string;
  conversational_context?: string;
  persona_id?: string;
  callback_url?: string;
  properties: {
    max_call_duration: number;
    participant_left_timeout: number;
    enable_recording: boolean;
    enable_closed_captions?: boolean;
  };
}

function resolveBaseUrl(request: Request): string {
  const explicit = process.env.TAVUS_CALLBACK_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (request.url.startsWith("https://") ? "https" : "http");
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.TAVUS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Tavus API key not configured" },
        { status: 503 }
      );
    }

    // `||` not `??` so an empty-string env var (common accidental value on
    // Vercel) falls through to the defaults instead of being sent as "".
    const replicaId =
      (process.env.TAVUS_REPLICA_ID || "").trim() || DEFAULT_REPLICA_ID;
    const personaId =
      (process.env.TAVUS_PERSONA_ID || "").trim() || DEFAULT_PERSONA_ID;
    console.log(
      "[Tavus] replica_id:",
      replicaId,
      "persona_id:",
      personaId
    );
    const baseUrl = resolveBaseUrl(request);
    const callbackUrl = baseUrl ? `${baseUrl}/api/tavus/webhook` : undefined;

    const payload: TavusConversationRequest = {
      replica_id: replicaId,
      conversation_name: "Walletta Cashier Demo",
      // Intentionally omit conversational_context — the Erewhon persona
      // we created already carries the full cashier system prompt. Pass
      // both and the replica drifts off-script (asks about "area and
      // location" etc) because the two prompts compete.
      properties: {
        max_call_duration: 1800,
        participant_left_timeout: 60,
        enable_recording: false,
      },
    };

    if (personaId) {
      payload.persona_id = personaId;
    }
    if (callbackUrl) {
      payload.callback_url = callbackUrl;
      console.log("[Tavus] callback_url:", callbackUrl);
    }

    const response = await fetch(TAVUS_API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Tavus API error: ${errorText}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as TavusSessionResponse;

    return NextResponse.json({
      conversationId: data.conversation_id,
      conversationUrl: data.conversation_url,
      replicaId,
      personaId: personaId ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create Tavus session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
