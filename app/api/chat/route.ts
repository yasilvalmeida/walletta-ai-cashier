import OpenAI from "openai";
import { ChatRequestSchema } from "@/lib/schemas";
import { getAllProducts } from "@/lib/catalog";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description:
        "Add a product to the customer's cart. Call this when a customer mentions they want a product.",
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
            description: "Price per unit in dollars",
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

function buildSystemPrompt(
  cartContext: { product_id: string; product_name: string; quantity: number; unit_price: number; line_total: number }[]
): string {
  const catalog = getAllProducts();
  const catalogSummary = catalog
    .map((p) => `- ${p.display_name} (${p.id}): $${p.price.toFixed(2)}`)
    .join("\n");

  const cartSummary =
    cartContext.length > 0
      ? cartContext
          .map(
            (i) =>
              `- ${i.product_name} x${i.quantity} @ $${i.unit_price.toFixed(2)} = $${i.line_total.toFixed(2)}`
          )
          .join("\n")
      : "Cart is empty.";

  return `You are an Erewhon cashier AI. You are warm, premium, and efficient. You help customers add items to their cart by name. When a customer mentions a product, call add_to_cart immediately. Always confirm what you added. Keep responses under 2 sentences.

## Available Products
${catalogSummary}

## Current Cart
${cartSummary}

Rules:
- Match products by name fuzzy search. Use the exact product_id and price from the catalog.
- Default quantity is 1 unless the customer specifies otherwise.
- If a product is not found, politely suggest similar items.
- For removals, use the product_id from the current cart.`;
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

            // Stream text deltas
            if (delta.content) {
              const event = JSON.stringify({
                type: "text",
                delta: delta.content,
              });
              controller.enqueue(
                encoder.encode(`data: ${event}\n\n`)
              );
            }

            // Accumulate tool call deltas
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

            // On finish, emit any completed tool calls as cart actions
            if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
              if (choice.finish_reason === "tool_calls") {
                needsFollowUp = true;
              }

              for (const tc of Object.values(toolCalls)) {
                try {
                  const payload = JSON.parse(tc.arguments);

                  if (tc.name === "add_to_cart") {
                    const event = JSON.stringify({
                      type: "cart_action",
                      action: "add_to_cart",
                      payload: {
                        product_id: payload.product_id,
                        product_name: payload.product_name,
                        quantity: payload.quantity || 1,
                        unit_price: payload.unit_price,
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

          // When GPT-4o returns only tool_calls without text, send tool
          // results back to get a spoken confirmation for the user.
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
            encoder.encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`
            )
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
