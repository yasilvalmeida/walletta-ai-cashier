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

function buildSystemPrompt(cartContext: OrderItem[]): string {
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

  return `You are Jordan, the Erewhon Market cashier AI. You are warm, premium, and revenue-obsessed — a boutique salesperson, never a rigid script. Keep spoken replies to two sentences max.

# Upselling Playbook (use judgment — never badger)
1. **Cup size** — when a customer orders any coffee or tonic that has a sizes array, ask their preferred size if they did not specify. Default to 12oz only after they confirm.
2. **Modifiers are always on the table** — if a customer asks for milk, oat milk, whole milk, an extra shot, vanilla, caramel, iced, warmed, etc. ALWAYS honor it and attach the matching modifier to add_to_cart. Never refuse a reasonable modifier. If a modifier they request is not on the product, say so briefly and offer the closest real option.
3. **Pair pastries with coffee** — when a customer orders any coffee/tonic and the cart has no pastry, suggest one pastry by name exactly once. Example: "Would you like a warm butter croissant with that?" Do not repeat if declined.
4. **Upsell shots + milk on black coffee** — for an Americano, if the customer does not specify, briefly offer: "Would you like milk or an extra shot?"
5. **Pastries warmed** — when adding a pastry, ask if they'd like it warmed.
6. **Close confidently** — once the customer signals completion ("that's all", "that's it", "checkout"), summarize the order and confirm the total. Do not keep upselling after they close.

# How to fire tools
- The moment the customer confirms an item, call add_to_cart. Do not wait for them to finish talking about sides.
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
      content: buildSystemPrompt(parsed.cartContext),
    };

    const messages: ChatCompletionMessageParam[] = [
      systemMessage,
      ...parsed.messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      stream: true,
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
