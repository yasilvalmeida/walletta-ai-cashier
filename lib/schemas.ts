import { z } from "zod";

export const CustomizationSchema = z.object({
  label: z.string(),
  price: z.number(),
});

export const SizeOptionSchema = z.object({
  label: z.string(),
  price_delta: z.number(),
});

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string(),
  category: z.enum(["smoothies", "coffee_tonics", "pastries"]),
  price: z.number(),
  unit: z.string(),
  ingredients: z.array(z.string()),
  customizations: z.array(CustomizationSchema),
  sizes: z.array(SizeOptionSchema).optional(),
  search_keywords: z.array(z.string()),
});

export const ModifierSchema = z.object({
  label: z.string(),
  price: z.number(),
});

export const OrderItemSchema = z.object({
  product_id: z.string(),
  product_name: z.string(),
  quantity: z.number().int().positive(),
  unit_price: z.number(),
  line_total: z.number(),
  size: z.string().optional(),
  modifiers: z.array(ModifierSchema).optional(),
});

export const CartEventAddSchema = z.object({
  type: z.literal("cart_action"),
  action: z.literal("add_to_cart"),
  payload: z.object({
    product_id: z.string(),
    product_name: z.string(),
    quantity: z.number().int().positive(),
    unit_price: z.number(),
    size: z.string().optional(),
    modifiers: z.array(ModifierSchema).optional(),
  }),
});

export const CartEventRemoveSchema = z.object({
  type: z.literal("cart_action"),
  action: z.literal("remove_from_cart"),
  payload: z.object({
    product_id: z.string(),
  }),
});

export const CartEventSchema = z.union([CartEventAddSchema, CartEventRemoveSchema]);

export const TextEventSchema = z.object({
  type: z.literal("text"),
  delta: z.string(),
});

export const DoneEventSchema = z.object({
  type: z.literal("done"),
});

export const SSEEventSchema = z.union([
  TextEventSchema,
  CartEventAddSchema,
  CartEventRemoveSchema,
  DoneEventSchema,
]);

export const ChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),
  cartContext: z.array(OrderItemSchema),
  // ISO-639-1 language code detected by Deepgram (e.g. "en", "es",
  // "zh"). Omitted if detection returned nothing on the turn.
  language: z.string().optional(),
});

export type Product = z.infer<typeof ProductSchema>;
export type Customization = z.infer<typeof CustomizationSchema>;
export type SizeOption = z.infer<typeof SizeOptionSchema>;
export type Modifier = z.infer<typeof ModifierSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type CartEvent = z.infer<typeof CartEventSchema>;
export type TextEvent = z.infer<typeof TextEventSchema>;
export type SSEEvent = z.infer<typeof SSEEventSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
