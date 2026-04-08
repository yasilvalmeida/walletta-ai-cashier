# Walletta AI Cashier

AI-powered checkout experience for Erewhon Market. An ultra-premium, minimalist cashier interface designed for iPad Pro landscape, featuring voice-driven cart management via a conversational AI avatar.

## Stack

- **Framework:** Next.js 16 (App Router) + TypeScript
- **Styling:** Tailwind CSS with Erewhon design tokens
- **Animation:** Framer Motion
- **AI Chat:** OpenAI GPT-4o with function calling (SSE streaming)
- **Avatar:** Tavus conversational video API
- **Video:** LiveKit SDK
- **Speech-to-Text:** Deepgram SDK
- **Text-to-Speech:** Cartesia
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
| `TAVUS_API_KEY` | Yes | Conversational avatar video |
| `LIVEKIT_API_KEY` | No | Real-time video transport |
| `LIVEKIT_API_SECRET` | No | LiveKit auth |
| `LIVEKIT_URL` | No | LiveKit server URL |
| `DEEPGRAM_API_KEY` | No | Speech-to-text |
| `CARTESIA_API_KEY` | No | Text-to-speech |

### 3. Run dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser (best viewed at 1366x1024 / iPad Pro landscape).

## Project Structure

```
walletta-ai-cashier/
├── app/
│   ├── layout.tsx                        # Root layout with Google Fonts
│   ├── page.tsx                          # Renders <CashierApp />
│   └── api/
│       ├── chat/route.ts                 # GPT-4o SSE streaming + cart function calling
│       ├── livekit/token/route.ts        # LiveKit JWT endpoint
│       ├── deepgram/token/route.ts       # Deepgram ephemeral key endpoint
│       └── tavus/session/route.ts        # Tavus conversation session
├── components/
│   ├── CashierApp.tsx                    # Split-screen layout (45% POS / 55% Avatar)
│   ├── avatar/
│   │   ├── AvatarPanel.tsx               # Video panel with Tavus integration
│   │   └── AvatarOverlay.tsx             # Connection status indicator
│   ├── pos/
│   │   ├── POSPanel.tsx                  # Cart list + summary
│   │   ├── CartItem.tsx                  # Animated cart row (Framer Motion)
│   │   ├── CartSummary.tsx               # Subtotal / Tax (9.5%) / Total
│   │   └── Receipt.tsx                   # Final receipt with QR code
│   └── ui/
│       ├── StatusBar.tsx                 # Connection + latency display
│       └── MicButton.tsx                 # VAD-aware microphone toggle
├── lib/
│   ├── catalog.ts                        # Product search and query helpers
│   ├── cart.ts                           # Pure cart logic functions
│   ├── sse.ts                            # SSE stream parser
│   ├── livekit.ts                        # LiveKit room helpers
│   └── schemas.ts                        # Zod schemas for all data types
├── data/
│   └── products.json                     # 45 Erewhon products (23 smoothies, 22 coffee & tonics)
├── hooks/
│   ├── useCart.ts                        # Cart state + SSE listener
│   ├── useVAD.ts                         # Voice activity detection
│   └── useTavus.ts                       # Tavus session lifecycle
└── store/
    └── cartStore.ts                      # Zustand cart store
```

## Architecture

The app uses a split-screen layout optimized for iPad Pro landscape (1366x1024):

- **Left panel (45%)** — POS/cart view with real-time item additions via Framer Motion animations
- **Right panel (55%)** — AI avatar video feed (Tavus + LiveKit)

### Chat Flow

1. Customer speaks → Deepgram STT → text
2. Text → `/api/chat` → GPT-4o with product catalog context
3. GPT-4o calls `add_to_cart` / `remove_from_cart` tools → SSE events
4. Frontend receives SSE → Zustand store updates → cart animates
5. GPT-4o text response → Cartesia TTS → avatar speaks

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

Erewhon aesthetic — warm cream palette, deep green accents:

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#F5F0E8` | Page background |
| `--surface` | `#FDFAF4` | Card/panel fill |
| `--accent` | `#2D5016` | Erewhon green |
| `--text-primary` | `#1A1714` | Headings, prices |

Typography: **Cormorant Garamond** (display/prices) + **DM Sans** (UI/labels).

## License

Private — Walletta Inc.
