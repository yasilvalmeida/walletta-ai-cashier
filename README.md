# Walletta AI Cashier

AI-powered checkout experience for Erewhon Market. A premium, voice-driven cashier interface featuring a full-screen conversational AI avatar with glassmorphic cart overlay.

## Stack

- **Framework:** Next.js 16 (App Router) + TypeScript
- **Styling:** Tailwind CSS v4 with Erewhon design tokens
- **Animation:** Framer Motion
- **AI Chat:** OpenAI GPT-4o with function calling (SSE streaming)
- **Avatar:** Tavus conversational video API (4K-ready)
- **Video:** LiveKit SDK
- **Speech-to-Text:** Deepgram Nova-2 (WebSocket streaming)
- **Text-to-Speech:** Cartesia Sonic-2 (sentence-level streaming)
- **State:** Zustand
- **Validation:** Zod

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in your API keys in `.env.local`:

| Key | Required | Description |
|-----|----------|-------------|
| `OPENAI_API_KEY` | Yes | Powers the AI cashier chat route |
| `DEEPGRAM_API_KEY` | Yes | Speech-to-text |
| `CARTESIA_API_KEY` | Yes | Text-to-speech |
| `TAVUS_API_KEY` | Yes | Conversational avatar video |
| `LIVEKIT_API_KEY` | Yes | Real-time video transport |
| `LIVEKIT_API_SECRET` | Yes | LiveKit auth |
| `LIVEKIT_URL` | Yes | LiveKit server URL |
| `CARTESIA_VOICE_ID` | No | Custom voice (defaults to built-in) |

### 3. Run dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — optimized for iPad Pro (1366x1024).

## Project Structure

```
walletta-ai-cashier/
├── app/
│   ├── layout.tsx                        # Root layout with Google Fonts
│   ├── page.tsx                          # Renders <CashierApp />
│   ├── globals.css                       # Tailwind v4 theme + glass-theme overrides
│   └── api/
│       ├── chat/route.ts                 # GPT-4o SSE streaming + function calling + tool follow-up
│       ├── tts/route.ts                  # Cartesia TTS proxy (WAV audio)
│       ├── livekit/token/route.ts        # LiveKit JWT endpoint
│       ├── deepgram/token/route.ts       # Deepgram key endpoint
│       └── tavus/session/route.ts        # Tavus conversation session
├── components/
│   ├── CashierApp.tsx                    # Portrait layout — full-screen avatar + overlays
│   ├── BottomSheet.tsx                   # Glassmorphic cart overlay (auto-expand on add)
│   ├── avatar/
│   │   └── AvatarOverlay.tsx             # Status indicator (Standby/Listening/Speaking)
│   ├── pos/
│   │   ├── CartItem.tsx                  # Animated cart row (Framer Motion)
│   │   ├── CartSummary.tsx               # Subtotal / Tax (9.5%) / Total
│   │   └── Receipt.tsx                   # QR code receipt on checkout
│   └── ui/
│       └── MicButton.tsx                 # Glassmorphic mic toggle
├── hooks/
│   ├── useConversation.ts               # Orchestrator: VAD + STT + LLM + streaming TTS
│   ├── useCartesiaTTS.ts                # Queue-based sentence streaming TTS
│   ├── useDeepgram.ts                   # Deepgram WebSocket STT + speech_final fallback
│   ├── useVAD.ts                        # Web Audio API voice activity detection
│   └── useTavus.ts                      # Tavus session lifecycle
├── lib/
│   ├── catalog.ts                        # Product search and query helpers
│   ├── cart.ts                           # Pure cart logic functions
│   ├── sse.ts                            # SSE stream parser
│   ├── overlay.ts                        # Status mapping + config
│   ├── livekit.ts                        # LiveKit room helpers
│   └── schemas.ts                        # Zod schemas for all data types
├── data/
│   └── products.json                     # 45 Erewhon products (23 smoothies, 22 coffee & tonics)
└── store/
    └── cartStore.ts                      # Zustand cart store with computed selectors
```

## Architecture

Full-screen portrait layout with the avatar owning the entire viewport:

- **Background** — Full-screen avatar video (Tavus 4K iframe, gradient placeholder)
- **Bottom sheet** — Glassmorphic cart overlay (`backdrop-blur-2xl`) that auto-expands when items are added
- **Floating controls** — Mic button (bottom center) + status indicator (top left) + transcript (top center)

### Voice Pipeline

```
User speaks → Deepgram STT (WebSocket) → transcript
         → /api/chat → GPT-4o (SSE streaming + function calling)
         → cart_action events → Zustand store → bottom sheet updates
         → text response → sentence-level TTS (Cartesia) → audio queue → playback
```

**Latency optimization:** Sentences stream to TTS as they complete — the first sentence starts playing while the LLM is still generating the rest.

**Interruption handling:** VAD speech-start immediately stops TTS playback and clears the audio queue.

### SSE Event Format

```
data: {"type":"text","delta":"Hello"}\n\n
data: {"type":"cart_action","action":"add_to_cart","payload":{...}}\n\n
data: {"type":"done"}\n\n
```

## Product Catalog

45 items from the Erewhon menu:

- **23 Smoothies** — $15.00 to $22.00
- **22 Coffee & Tonics** — $5.00 to $14.00

Each product includes ingredients, customizations with pricing, and search keywords for fuzzy matching.

## Design

Dark portrait mode with glassmorphism overlays:

| Element | Style |
|---------|-------|
| Background | Dark gradient (`zinc-900` to `black`) |
| Bottom sheet | `backdrop-blur-2xl bg-black/50 border-white/10` |
| Status overlay | `backdrop-blur-xl bg-black/40` |
| Mic button | `bg-white/10 backdrop-blur-xl` (idle) / `bg-accent` (active) |
| Text | White with opacity variants (`white/90`, `white/70`, `white/45`) |

Typography: **Cormorant Garamond** (display/prices) + **DM Sans** (UI/labels).

## License

Private — Walletta Inc.
