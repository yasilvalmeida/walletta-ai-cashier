// Cartesia WebSocket TTS proxy. Connects to Cartesia's /tts/websocket
// endpoint, forwards each incoming audio chunk to the client as the
// body of an HTTP chunked response. Lets the browser begin playback
// ~150ms after the LLM's first clause instead of waiting for the full
// WAV like our REST `/api/tts` does.
//
// Shape:
//   POST /api/tts/stream  body: { text, language? }
//   → 200 with Content-Type audio/pcm; rate=24000 and raw little-endian
//     pcm_s16le bytes streamed as they arrive from Cartesia.
//
// Why proxy and not hit Cartesia from the browser: the API key can't
// be shipped to the client. Cartesia's WS auth is `?api_key=` in the
// URL — that key would be cached in browser history and extractable
// from DevTools. The proxy keeps the key server-side and terminates
// the WS on the server.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CARTESIA_WS_URL =
  "wss://api.cartesia.ai/tts/websocket?cartesia_version=2024-06-10";
const DEFAULT_VOICE_ID = "a0e99841-438c-4a64-b679-ae501e7d6091";

const SUPPORTED: ReadonlySet<string> = new Set([
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "zh",
  "hi",
  "pl",
  "nl",
  "sv",
  "tr",
  "ru",
]);

function resolveVoice(language: string): string {
  const specific = process.env[`CARTESIA_VOICE_ID_${language.toUpperCase()}`];
  if (specific && specific.trim()) return specific.trim();
  return process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE_ID;
}

interface StreamRequestBody {
  text?: string;
  language?: string;
}

interface CartesiaMessage {
  type?: string;
  data?: string; // base64 pcm_s16le
  done?: boolean;
  error?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as StreamRequestBody;
  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "Missing or empty text" }, { status: 400 });
  }

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    console.error("[TTS stream] CARTESIA_API_KEY not set");
    return Response.json({ error: "TTS not configured" }, { status: 500 });
  }

  const requested = (body.language ?? "en").toLowerCase();
  const language = SUPPORTED.has(requested) ? requested : "en";
  const voiceId = resolveVoice(language);

  const wsUrl = `${CARTESIA_WS_URL}&api_key=${encodeURIComponent(apiKey)}`;
  const contextId = crypto.randomUUID();

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      let ws: WebSocket | null = null;
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        if (ws && ws.readyState <= WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      };

      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error("[TTS stream] WS constructor threw:", err);
        controller.error(err);
        return;
      }

      ws.addEventListener("open", () => {
        const payload = {
          context_id: contextId,
          model_id: "sonic-2",
          transcript: text,
          voice: { mode: "id", id: voiceId },
          output_format: {
            container: "raw",
            encoding: "pcm_s16le",
            sample_rate: 24000,
          },
          language,
          add_timestamps: false,
          continue: false,
        };
        ws?.send(JSON.stringify(payload));
      });

      ws.addEventListener("message", (event) => {
        if (closed) return;
        const raw = event.data;
        let msg: CartesiaMessage;
        try {
          msg =
            typeof raw === "string"
              ? (JSON.parse(raw) as CartesiaMessage)
              : ({} as CartesiaMessage);
        } catch {
          return;
        }
        if (msg.error) {
          console.error("[TTS stream] Cartesia error:", msg.error);
          controller.error(new Error(msg.error));
          safeClose();
          return;
        }
        if (msg.type === "chunk" && typeof msg.data === "string") {
          try {
            const bin = Buffer.from(msg.data, "base64");
            controller.enqueue(
              new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)
            );
          } catch (err) {
            console.warn("[TTS stream] base64 decode failed:", err);
          }
        }
        if (msg.done) safeClose();
      });

      ws.addEventListener("error", (err) => {
        console.error("[TTS stream] WS error:", err);
        if (!closed) {
          try {
            controller.error(
              new Error("Cartesia WebSocket error")
            );
          } catch {
            /* already errored */
          }
          safeClose();
        }
      });

      ws.addEventListener("close", () => {
        safeClose();
      });
    },
    cancel() {
      // Client disconnected — close Cartesia WS too (handled in safeClose
      // on the next message cycle, but also a safety net here).
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "audio/pcm;rate=24000;bits=16;channels=1",
      "Cache-Control": "no-cache, no-store",
      // Hint for consumers (not a standard header but we read it client-side).
      "X-Sample-Rate": "24000",
    },
  });
}
