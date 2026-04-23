const CARTESIA_API_URL = "https://api.cartesia.ai/tts/bytes";
const DEFAULT_VOICE_ID = "a0e99841-438c-4a64-b679-ae501e7d6091";

// Cartesia Sonic-2 accepts these language codes per the docs. Anything
// else falls back to English so we never send a rejected request.
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
  // Per-language overrides set in Vercel env (e.g. CARTESIA_VOICE_ID_ES).
  // Fall back to CARTESIA_VOICE_ID (the tuned EN voice) so unknown
  // languages still sound like the same cashier brand.
  const specific = process.env[`CARTESIA_VOICE_ID_${language.toUpperCase()}`];
  if (specific && specific.trim()) return specific.trim();
  return process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE_ID;
}

interface TTSRequestBody {
  text?: string;
  language?: string;
}

export async function POST(request: Request) {
  // Page-load warmup fast-path — `?warmup=1` primes the Node VM
  // without hitting Cartesia or the devtools console.
  if (new URL(request.url).searchParams.get("warmup") === "1") {
    return new Response(null, { status: 204 });
  }

  const body = (await request.json()) as TTSRequestBody;
  const text = body.text;

  if (!text || !text.trim()) {
    return Response.json({ error: "Missing or empty text" }, { status: 400 });
  }

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    console.error("[TTS] CARTESIA_API_KEY not set");
    return Response.json({ error: "TTS not configured" }, { status: 500 });
  }

  const requested = (body.language ?? "en").toLowerCase();
  const language = SUPPORTED.has(requested) ? requested : "en";
  const voiceId = resolveVoice(language);

  try {
    const response = await fetch(CARTESIA_API_URL, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-06-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-2",
        transcript: text.trim(),
        voice: {
          mode: "id",
          id: voiceId,
        },
        output_format: {
          container: "wav",
          encoding: "pcm_s16le",
          sample_rate: 24000,
        },
        language,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[TTS] Cartesia error:", response.status, errorBody);
      return Response.json(
        { error: "TTS generation failed" },
        { status: 502 }
      );
    }

    const audioBytes = await response.arrayBuffer();

    return new Response(audioBytes, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS request failed";
    console.error("[TTS] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
