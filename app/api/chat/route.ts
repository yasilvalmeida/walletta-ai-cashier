import OpenAI from "openai";
import { ChatRequestSchema } from "@/lib/schemas";
import { getAllProducts } from "@/lib/catalog";
import type { Modifier, OrderItem, Product } from "@/lib/schemas";
import type {
  ChatCompletionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description:
        "Add a product to the customer's cart. Call this the moment the customer confirms an item. Include any size and modifiers they requested (milk, extra shot, syrup, warmed, etc).",
      parameters: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "The unique product identifier from the catalog",
          },
          product_name: {
            type: "string",
            description: "The display name of the product",
          },
          quantity: {
            type: "number",
            description: "Number of items to add (default 1)",
          },
          unit_price: {
            type: "number",
            description:
              "Base price per unit in dollars. If a size is chosen, use base price + size price_delta as unit_price.",
          },
          size: {
            type: "string",
            description:
              "Optional size label (e.g. '12oz', '16oz'). Only include for products that have a sizes array in the catalog.",
          },
          modifiers: {
            type: "array",
            description:
              "Optional modifier list — each modifier matches a label + price from the product's customizations array.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                price: { type: "number" },
              },
              required: ["label", "price"],
            },
          },
        },
        required: ["product_id", "product_name", "quantity", "unit_price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_from_cart",
      description:
        "Remove a product from the customer's cart. Call this when a customer wants to remove an item.",
      parameters: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "The product ID to remove from the cart",
          },
        },
        required: ["product_id"],
      },
    },
  },
];

function formatProductForPrompt(p: Product): string {
  const customs =
    p.customizations.length > 0
      ? `\n    modifiers: ${p.customizations
          .map((c) => `${c.label} (+$${c.price.toFixed(2)})`)
          .join(", ")}`
      : "";
  const sizes =
    p.sizes && p.sizes.length > 0
      ? `\n    sizes: ${p.sizes
          .map((s) => `${s.label} (+$${s.price_delta.toFixed(2)})`)
          .join(", ")}`
      : "";
  return `- ${p.display_name} (${p.id}): $${p.price.toFixed(2)}${sizes}${customs}`;
}

// Maps ISO-639-1 codes from Deepgram to human-readable names GPT-4o
// recognizes unambiguously in the language-mirror instruction. English
// is the default and does not need to be declared.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  zh: "Mandarin Chinese",
  fr: "French",
  de: "German",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  it: "Italian",
};

function timeContextLine(): string {
  // Erewhon Venice is on PT. Use America/Los_Angeles so the upsell
  // recommendation matches what a human cashier would say on the floor
  // regardless of the server's clock.
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
  if (hour >= 5 && hour < 11) {
    return "TIME CONTEXT: Morning — pair a warmed pastry with coffee; lean toward hot drinks and breakfast pastries.";
  }
  if (hour >= 11 && hour < 15) {
    return "TIME CONTEXT: Midday — smoothies, iced coffee, and lighter pastries sell best.";
  }
  if (hour >= 15 && hour < 19) {
    return "TIME CONTEXT: Afternoon — suggest iced drinks, tonics, and a pick-me-up pastry.";
  }
  return "TIME CONTEXT: Evening — keep it light, suggest tonics or smoothies; avoid pushing espresso.";
}

function buildSystemPrompt(
  cartContext: OrderItem[],
  language?: string
): string {
  const catalog = getAllProducts();
  const smoothies = catalog.filter((p) => p.category === "smoothies");
  const coffee = catalog.filter((p) => p.category === "coffee_tonics");
  const pastries = catalog.filter((p) => p.category === "pastries");

  const section = (title: string, items: Product[]): string =>
    `### ${title}\n${items.map(formatProductForPrompt).join("\n")}`;

  const menu = [
    section("Smoothies", smoothies),
    section("Coffee & Tonics", coffee),
    section("Pastries", pastries),
  ].join("\n\n");

  const subtotal = cartContext.reduce((sum, i) => sum + i.line_total, 0);
  const tax = subtotal * 0.095;
  const total = subtotal + tax;

  const cartSummary =
    cartContext.length > 0
      ? cartContext
          .map((i) => {
            const extras: string[] = [];
            if (i.size) extras.push(`size: ${i.size}`);
            if (i.modifiers && i.modifiers.length > 0) {
              extras.push(
                `modifiers: ${i.modifiers.map((m: Modifier) => m.label).join(", ")}`
              );
            }
            const extra = extras.length > 0 ? ` [${extras.join("; ")}]` : "";
            return `- ${i.product_name} x${i.quantity} @ $${i.unit_price.toFixed(2)}${extra} = $${i.line_total.toFixed(2)}`;
          })
          .join("\n") +
        `\n\nSubtotal: $${subtotal.toFixed(2)}\nTax (9.5%): $${tax.toFixed(2)}\nTotal: $${total.toFixed(2)}`
      : "Cart is empty.";

  const languageLine =
    language && language !== "en" && LANGUAGE_NAMES[language]
      ? `\n# Language\nThe customer just spoke ${LANGUAGE_NAMES[language]} (Deepgram code \"${language}\"). Respond entirely in ${LANGUAGE_NAMES[language]}. Keep prices, product IDs, and catalog-exact product names in their original English (e.g. "Malibu Mango", "Butter Croissant", "$5.50") so add_to_cart arguments remain deterministic.\n`
      : "";

  return `You are Jordan, the Erewhon Market cashier AI. You are warm, premium, and revenue-obsessed — a boutique salesperson, never a rigid script. Keep spoken replies to two sentences max.
${languageLine}
${timeContextLine()}

# Upselling Playbook (use judgment — never badger)
1. **Cup size — REQUIRED.** For any coffee or tonic with a sizes array, if the customer did not name a size, your first reply MUST offer the ladder ("12, 16, or 20 ounce?") before confirming. Do not default to 12oz silently.
2. **Modifiers are always on the table** — if a customer asks for milk, oat milk, whole milk, an extra shot, vanilla, caramel, iced, warmed, etc. ALWAYS honor it and attach the matching modifier to add_to_cart. Never refuse a reasonable modifier. If a modifier they request is not on the product, say so briefly and offer the closest real option.
3. **Pair a pastry with coffee** — when a customer orders any coffee/tonic and the cart has no pastry, suggest ONE pastry by name exactly once. Morning → warmed butter croissant or morning bun; midday/afternoon → scone or blueberry muffin. Do not repeat if declined.
4. **Upsell shots + milk on black coffee** — for an Americano, if the customer does not specify, briefly offer: "Would you like milk or an extra shot?"
5. **Pastries warmed** — when adding a pastry, ask if they'd like it warmed.
6. **Close confidently — stop upselling.** Once the customer signals completion ("that's all", "that's it", "checkout", "I'm done", "no thanks"), DO NOT suggest anything else. Read back the order tersely ("One 16oz oat latte and a warm butter croissant — eleven twenty-five total.") and stop. Adding a pastry suggestion after "that's all" is a critical failure.

# How to fire tools — ABSOLUTE RULES
- The SECOND you see a menu item named (exactly or fuzzily — "Malibu Mango", "Amalibu Mango", "Maripo Mango", "Malibu", "the mango one"... all mean smoothie-malibu-mango), CALL add_to_cart BEFORE speaking. You do NOT need the customer to say "yes" or "please" first. Naming the item IS the confirmation. Your speech can be a simple acknowledgment like "Got it, one Malibu Mango — anything else?"
- Customer transcripts come from a speech-to-text pipeline that mis-hears brand names (Malibu → Amalibu, Erewhon → Ere one, etc). Always fuzzy-match against the catalog. If a mangled word is closer to one catalog item than any other, call add_to_cart for that item. Do NOT ask "did you mean X?" — just add X and mention the match in passing.
- If your reply text mentions an item being added / ordered / picked / gotten, add_to_cart MUST have fired THIS response. Saying "I've added X" or "your total is Y" without the tool call is a critical bug.
- "That's all" / "no, that's all" / "I'm done" / "checkout" ends the order. Do NOT add more items on that turn. If a fuzzy item was mentioned earlier and you forgot to call add_to_cart then, call it NOW before finalizing.
- Use the exact product_id and base price from the catalog.
- If a size was selected, pass unit_price = base price + size price_delta, and pass the size label.
- Pass modifiers as an array of {label, price} — labels must match the catalog customizations exactly.
- For removals, use product_id from the current cart.

# Full Menu
${menu}

# Current Cart (SOURCE OF TRUTH — always use these quantities and totals)
${cartSummary}

# Rules
- Match products by fuzzy name/keyword search. Use exact product_id and base price from the catalog.
- Default quantity is 1.
- If a product is not on the menu, politely suggest the closest item we do carry.
- When asked about totals or cart contents, ONLY use the Current Cart section above. Never count from conversation history.
- Speak like a premium Erewhon host: warm, unhurried, confident. Never robotic.`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ChatRequestSchema.parse(body);

    const systemMessage: ChatCompletionMessageParam = {
      role: "system",
      content: buildSystemPrompt(parsed.cartContext, parsed.language),
    };

    const messages: ChatCompletionMessageParam[] = [
      systemMessage,
      ...parsed.messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    // Detect if the latest user message mentions ANY menu item (even
    // loosely). If it does, force the LLM to emit add_to_cart — it keeps
    // trying to ask for "did you mean X?" or verbalises additions without
    // actually calling the tool, so we make the tool call deterministic
    // whenever a catalog match exists.
    const lastUser = [...parsed.messages]
      .reverse()
      .find((m) => m.role === "user");
    const userText = (lastUser?.content ?? "").toLowerCase();
    const catalogWords = new Set<string>();
    for (const p of getAllProducts()) {
      for (const tok of p.name.toLowerCase().split(/\s+/)) {
        if (tok.length >= 4) catalogWords.add(tok);
      }
      for (const kw of p.search_keywords) {
        if (kw.length >= 4) catalogWords.add(kw.toLowerCase());
      }
    }
    const mentionsItem =
      userText.length > 0 &&
      [...catalogWords].some((w) => userText.includes(w));
    // Remove / correction intent — "remove", "take off", "cancel",
    // "delete", "scratch that", "no [item]", "instead", "change",
    // "actually", "just one / two / three", "only one". If the user
    // says any of these and references an item, we should NOT force
    // add_to_cart; let the LLM pick remove_from_cart (or nothing) on
    // its own.
    const isRemoveOrCorrection =
      /\b(remove|take\s+off|cancel|delete|scratch\s+that|instead|change|actually|only|just\s+(?:one|two|three|1|2|3))\b/.test(
        userText
      ) ||
      /\bno[,\s]+(?:the|that|not)\b/.test(userText);
    const isPureFinalize =
      userText === "done" ||
      userText === "that's all" ||
      userText === "that is all" ||
      userText === "no, that's all." ||
      userText === "no, that's all" ||
      userText === "checkout" ||
      userText === "no. that's all." ||
      userText === "pay";
    const forceAdd = mentionsItem && !isPureFinalize && !isRemoveOrCorrection;
    console.log(
      "[Chat] forceAdd =",
      forceAdd,
      "remove/correct =",
      isRemoveOrCorrection,
      "user:",
      userText.slice(0, 80)
    );

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      stream: true,
      tool_choice: forceAdd
        ? { type: "function", function: { name: "add_to_cart" } }
        : "auto",
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const toolCalls: Record<
          number,
          { id: string; name: string; arguments: string }
        > = {};
        let needsFollowUp = false;

        try {
          for await (const chunk of stream) {
            const choice = chunk.choices[0];
            if (!choice) continue;

            const delta = choice.delta;

            if (delta.content) {
              const event = JSON.stringify({
                type: "text",
                delta: delta.content,
              });
              controller.enqueue(
                encoder.encode(`data: ${event}\n\n`)
              );
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCalls[tc.index]) {
                  toolCalls[tc.index] = {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    arguments: "",
                  };
                }
                if (tc.id) {
                  toolCalls[tc.index].id = tc.id;
                }
                if (tc.function?.name) {
                  toolCalls[tc.index].name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  toolCalls[tc.index].arguments +=
                    tc.function.arguments;
                }
              }
            }

            if (
              choice.finish_reason === "tool_calls" ||
              choice.finish_reason === "stop"
            ) {
              if (choice.finish_reason === "tool_calls") {
                needsFollowUp = true;
              }

              for (const tc of Object.values(toolCalls)) {
                try {
                  const payload = JSON.parse(tc.arguments);

                  if (tc.name === "add_to_cart") {
                    const modifiers: Modifier[] | undefined = Array.isArray(
                      payload.modifiers
                    )
                      ? payload.modifiers
                          .filter(
                            (m: unknown): m is Modifier =>
                              typeof m === "object" &&
                              m !== null &&
                              typeof (m as Modifier).label === "string" &&
                              typeof (m as Modifier).price === "number"
                          )
                      : undefined;

                    const event = JSON.stringify({
                      type: "cart_action",
                      action: "add_to_cart",
                      payload: {
                        product_id: payload.product_id,
                        product_name: payload.product_name,
                        quantity: payload.quantity || 1,
                        unit_price: payload.unit_price,
                        ...(typeof payload.size === "string" && payload.size
                          ? { size: payload.size }
                          : {}),
                        ...(modifiers && modifiers.length > 0
                          ? { modifiers }
                          : {}),
                      },
                    });
                    controller.enqueue(
                      encoder.encode(`data: ${event}\n\n`)
                    );
                  } else if (tc.name === "remove_from_cart") {
                    const event = JSON.stringify({
                      type: "cart_action",
                      action: "remove_from_cart",
                      payload: {
                        product_id: payload.product_id,
                      },
                    });
                    controller.enqueue(
                      encoder.encode(`data: ${event}\n\n`)
                    );
                  }
                } catch {
                  // Skip malformed tool call arguments
                }
              }
            }
          }

          if (needsFollowUp && Object.keys(toolCalls).length > 0) {
            const assistantMsg: ChatCompletionMessageParam = {
              role: "assistant",
              tool_calls: Object.values(toolCalls).map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            };

            const toolResults: ChatCompletionMessageParam[] =
              Object.values(toolCalls).map((tc) => ({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: JSON.stringify({ success: true }),
              }));

            const followUp = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [...messages, assistantMsg, ...toolResults],
              stream: true,
            });

            for await (const chunk of followUp) {
              const delta = chunk.choices[0]?.delta;
              if (delta?.content) {
                const event = JSON.stringify({
                  type: "text",
                  delta: delta.content,
                });
                controller.enqueue(
                  encoder.encode(`data: ${event}\n\n`)
                );
              }
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`
            )
          );
        } finally {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
