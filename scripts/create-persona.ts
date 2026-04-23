#!/usr/bin/env tsx
/**
 * One-time script to create a Tavus persona with custom LLM + TTS
 * layers that point at Groq (Llama 3.3 70B on LPU) and Cartesia Sonic-2
 * respectively — the single biggest Tavus-mode latency win.
 *
 * Why: in Tavus mode the replica is driven by Tavus's OWN internal
 * STT+LLM+TTS pipeline. Default Tavus personas run Tavus's in-house
 * LLM + Tavus's default TTS. By pointing `layers.llm` at Groq and
 * `layers.tts` at Cartesia we redirect both hops to the fastest
 * available providers, cutting Tavus's ~1s gap to ~400-500ms.
 *
 * Usage (run from the project root):
 *
 *   TAVUS_API_KEY=xxx \
 *   GROQ_API_KEY=gsk_xxx \
 *   CARTESIA_API_KEY=xxx \
 *   CARTESIA_VOICE_ID=xxx \
 *   TAVUS_REPLICA_ID=r5f0577fc829 \
 *     npx tsx scripts/create-persona.ts
 *
 * The script prints a single line: TAVUS_PERSONA_ID=<new id>
 * Copy that into your Vercel env and the new persona goes live on next
 * session creation — no code redeploy needed.
 *
 * References: Tavus CVI persona config docs.
 */

const TAVUS_API = "https://tavusapi.com/v2/personas";

const SYSTEM_PROMPT = `You are Jordan, the Erewhon Market cashier AI. Warm, premium, revenue-aware. Keep spoken replies to two sentences max.

Upselling playbook — use judgment, never badger:
- Cup size is mandatory on any sized drink: if the customer didn't name one, ask "12, 16, or 20 ounce?" before confirming.
- Honor any modifier (oat milk, almond milk, whole milk, extra shot, vanilla, caramel, iced, warmed). Attach it via add_to_cart; never refuse a reasonable mod.
- Pair one pastry with coffee orders. Morning → warmed croissant or morning bun; afternoon → scone or muffin. Never suggest twice.
- On a plain Americano, briefly offer milk or an extra shot.
- On pastries, ask if they'd like it warmed.
- When the customer signals close ("that's all", "that's it", "I'm done", "checkout", "no thanks") STOP upselling. Read back the order tersely and confirm the total.

Tool use:
- The second a customer names a menu item, call add_to_cart BEFORE speaking. Naming is confirmation; you do not need a "yes".
- STT mis-hears brand names (Malibu → Amalibu, Erewhon → Ere one). Fuzzy-match to the closest catalog item; add it and mention the match in passing.
- If you say "I've added X" or "your total is Y" without firing the tool, the cart desyncs. Always tool-call first.

Respond in whatever language the customer speaks. Keep prices and product IDs in English so the cart stays deterministic.`;

interface PersonaPayload {
  persona_name: string;
  system_prompt: string;
  context?: string;
  default_replica_id: string;
  layers: {
    llm: {
      model: string;
      base_url: string;
      api_key: string;
      speculative_inference?: boolean;
    };
    tts: {
      tts_engine: string;
      voice_id: string;
      api_key: string;
    };
    perception?: {
      perception_model: "off" | "raven-0";
    };
  };
}

async function main() {
  const required = {
    TAVUS_API_KEY: process.env.TAVUS_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    CARTESIA_API_KEY: process.env.CARTESIA_API_KEY,
    CARTESIA_VOICE_ID: process.env.CARTESIA_VOICE_ID,
    TAVUS_REPLICA_ID: process.env.TAVUS_REPLICA_ID ?? "r5f0577fc829",
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error(
      "Missing required env vars:",
      missing.join(", "),
      "\nSee header comment in scripts/create-persona.ts for usage."
    );
    process.exit(1);
  }

  const payload: PersonaPayload = {
    persona_name: "Walletta Erewhon Cashier (Groq+Cartesia)",
    system_prompt: SYSTEM_PROMPT,
    default_replica_id: required.TAVUS_REPLICA_ID!,
    layers: {
      llm: {
        model: "llama-3.3-70b-versatile",
        base_url: "https://api.groq.com/openai/v1",
        api_key: required.GROQ_API_KEY!,
        speculative_inference: true,
      },
      tts: {
        tts_engine: "cartesia",
        voice_id: required.CARTESIA_VOICE_ID!,
        api_key: required.CARTESIA_API_KEY!,
      },
      // Perception (raven-0) adds face/object detection latency that we
      // don't need for a cashier kiosk — explicitly off.
      perception: { perception_model: "off" },
    },
  };

  const res = await fetch(TAVUS_API, {
    method: "POST",
    headers: {
      "x-api-key": required.TAVUS_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(
      `Tavus persona creation failed: HTTP ${res.status}\n${text}`
    );
    process.exit(1);
  }

  const body = (await res.json()) as { persona_id?: string };
  if (!body.persona_id) {
    console.error("Tavus response missing persona_id:", JSON.stringify(body));
    process.exit(1);
  }

  console.log("\n✓ Persona created.\n");
  console.log(`TAVUS_PERSONA_ID=${body.persona_id}\n`);
  console.log(
    "Paste that into Vercel env (overwriting the existing TAVUS_PERSONA_ID) and redeploy.\n"
  );
}

main().catch((err) => {
  console.error("create-persona failed:", err);
  process.exit(1);
});
