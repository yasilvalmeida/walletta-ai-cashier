import { NextResponse } from "next/server";
import {
  publishTranscript,
  clearConversation,
} from "@/lib/tavusEvents";

// Tavus's event payloads vary by event_type; this handler is permissive
// and pulls transcript text + role from the shapes seen in practice.
interface TavusEventBody {
  event_type?: string;
  message_type?: string;
  conversation_id?: string;
  properties?: Record<string, unknown>;
  transcript?: unknown;
}

function readString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

export async function POST(request: Request) {
  let body: TavusEventBody;
  try {
    body = (await request.json()) as TavusEventBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const conversationId = body.conversation_id;
  if (!conversationId) {
    return NextResponse.json({ ok: true, note: "no conversation_id" });
  }

  const eventType = body.event_type ?? body.message_type ?? "";
  console.log("[Tavus webhook] event:", eventType, conversationId);
  // For transcription_ready the body can be >10KB because of the system
  // prompt — log just the turn roles + short previews so we can see
  // what the extractor will work with.
  if (eventType === "application.transcription_ready") {
    const t = (body.properties as Record<string, unknown> | undefined)
      ?.transcript;
    if (Array.isArray(t)) {
      console.log("[Tavus webhook] transcript turns:", t.length);
      t.forEach((turn, i) => {
        if (turn && typeof turn === "object") {
          const rec = turn as Record<string, unknown>;
          const role = typeof rec.role === "string" ? rec.role : "?";
          const content = typeof rec.content === "string" ? rec.content : "";
          console.log(
            `[Tavus webhook]   [${i}] ${role}: ${content.slice(0, 120).replace(/\n/g, " ")}`
          );
        }
      });
    }
  }

  // Utterance event — the main thing we care about. Tavus sends these for
  // both user and replica turns with the text and role.
  // Real-time per-turn event (only fires when a persona is attached).
  const isUtterance =
    eventType === "conversation.utterance" ||
    eventType === "conversation.utterance_streaming" ||
    eventType.startsWith("conversation.utterance");

  if (isUtterance) {
    const props = body.properties ?? {};
    const role = (readString(props, "role") ??
      readString(props, "speaker") ??
      "user") as "user" | "replica" | "system";
    const speech =
      readString(props, "speech") ??
      readString(props, "transcript") ??
      readString(props, "text") ??
      "";

    if (speech.trim()) {
      publishTranscript({
        conversationId,
        role: role === "replica" || role === "system" ? role : "user",
        speech: speech.trim(),
        timestamp: Date.now(),
      });
    }
  }

  // Post-call fallback: if real-time events never came through (older
  // sessions without a persona, or if Tavus drops events), the full
  // transcript arrives here. Fan each user turn out through the same
  // pub/sub so the client can replay them into /api/chat. The client-
  // side dedupe (line keys) prevents double-adding when both real-time
  // and post-call paths succeed.
  if (eventType === "application.transcription_ready") {
    const props = body.properties ?? {};
    const transcript = (props as Record<string, unknown>).transcript;
    if (Array.isArray(transcript)) {
      for (const turn of transcript) {
        if (!turn || typeof turn !== "object") continue;
        const rec = turn as Record<string, unknown>;
        const role = typeof rec.role === "string" ? rec.role : "";
        const content = typeof rec.content === "string" ? rec.content : "";
        if (role !== "user" || !content.trim()) continue;
        publishTranscript({
          conversationId,
          role: "user",
          speech: content.trim(),
          timestamp: Date.now(),
        });
      }
    }
  }

  // Cleanup when Tavus says the conversation is over.
  if (
    eventType.includes("shutdown") ||
    eventType.includes("ended") ||
    eventType === "conversation.ended"
  ) {
    clearConversation(conversationId);
  }

  return NextResponse.json({ ok: true });
}
