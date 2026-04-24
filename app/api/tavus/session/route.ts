import { NextResponse } from "next/server";
import { endAllActiveConversations, isMaxConcurrentError } from "@/lib/tavus";

const TAVUS_API = "https://tavusapi.com/v2/conversations";
// After we end conversations, Tavus's concurrency counter lags the
// /v2/conversations list by ~1s. Retrying the create POST immediately
// reproduces the same 400, so we pause briefly before the second attempt.
const MAX_CONCURRENT_RETRY_DELAY_MS = 1500;
const DEFAULT_REPLICA_ID = "r5f0577fc829";
// Erewhon Cashier persona (no tools). Tavus delivers the full
// conversation transcript at session end via
// application.transcription_ready — we parse each user turn out of
// that and replay it through /api/chat to populate the cart. The
// tool-enabled variant (p8320500b2f2) seems to suppress user turns
// in the final transcript, so we stay on this one.
const DEFAULT_PERSONA_ID = "pe2d1f72ee4b";

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
        // 180s (was 60s) — belt-and-suspenders with the client-side
        // useSessionIdleTimeout hook. Temur got billed 271min for 15min
        // of testing on 2026-04-24 because sessions stayed alive in the
        // background. Primary control is the client timer; this is a
        // fallback for client bugs / lost-pagehide beacons.
        participant_left_timeout: 180,
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

    const createConversation = () =>
      fetch(TAVUS_API, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

    let response = await createConversation();
    let failureText = "";

    if (!response.ok) {
      failureText = await response.text();
      if (isMaxConcurrentError(response.status, failureText)) {
        console.warn(
          "[Tavus] max concurrent reached, ending active sessions and retrying"
        );
        const cleanup = await endAllActiveConversations(apiKey);
        console.warn(
          "[Tavus] cleanup scanned=",
          cleanup.scanned,
          "ended=",
          cleanup.ended
        );
        await new Promise((r) => setTimeout(r, MAX_CONCURRENT_RETRY_DELAY_MS));
        response = await createConversation();
        failureText = response.ok ? "" : await response.text();
      }

      if (!response.ok) {
        console.error(
          "[Tavus] session create failed:",
          response.status,
          failureText
        );
        return NextResponse.json(
          { error: `Tavus API error: ${failureText}` },
          { status: response.status }
        );
      }
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
