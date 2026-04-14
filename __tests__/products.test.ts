import { describe, it, expect } from "vitest";
import products from "@/data/products.json";
import { ProductSchema } from "@/lib/schemas";

describe("products.json", () => {
  it("has exactly 51 products", () => {
    expect(products).toHaveLength(51);
  });

  it("has 23 smoothies", () => {
    const smoothies = products.filter((p) => p.category === "smoothies");
    expect(smoothies).toHaveLength(23);
  });

  it("has 22 coffee & tonics", () => {
    const coffee = products.filter((p) => p.category === "coffee_tonics");
    expect(coffee).toHaveLength(22);
  });

  it("has 6 pastries", () => {
    const pastries = products.filter((p) => p.category === "pastries");
    expect(pastries).toHaveLength(6);
  });

  it("all products have unique IDs", () => {
    const ids = products.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("smoothie IDs start with 'smoothie-'", () => {
    const smoothies = products.filter((p) => p.category === "smoothies");
    for (const s of smoothies) {
      expect(s.id).toMatch(/^smoothie-/);
    }
  });

  it("coffee IDs start with 'coffee-'", () => {
    const coffee = products.filter((p) => p.category === "coffee_tonics");
    for (const c of coffee) {
      expect(c.id).toMatch(/^coffee-/);
    }
  });

  it("pastry IDs start with 'pastry-'", () => {
    const pastries = products.filter((p) => p.category === "pastries");
    for (const p of pastries) {
      expect(p.id).toMatch(/^pastry-/);
    }
  });

  it("all prices are positive numbers", () => {
    for (const p of products) {
      expect(p.price).toBeGreaterThan(0);
      expect(typeof p.price).toBe("number");
    }
  });

  it("all customization prices are non-negative numbers", () => {
    for (const p of products) {
      for (const c of p.customizations) {
        expect(c.price).toBeGreaterThanOrEqual(0);
        expect(typeof c.price).toBe("number");
      }
    }
  });

  it("all products have at least one ingredient", () => {
    for (const p of products) {
      expect(p.ingredients.length).toBeGreaterThan(0);
    }
  });

  it("all products have 4-6 search keywords", () => {
    for (const p of products) {
      expect(p.search_keywords.length).toBeGreaterThanOrEqual(4);
      expect(p.search_keywords.length).toBeLessThanOrEqual(6);
    }
  });

  it("Americano exposes multiple milk + size modifiers for upselling", () => {
    const americano = products.find((p) => p.id === "coffee-americano");
    expect(americano).toBeDefined();
    const labels = americano!.customizations.map((c) => c.label.toLowerCase());
    const milkLabels = labels.filter((l) => l.includes("milk"));
    expect(milkLabels.length).toBeGreaterThanOrEqual(3);
    expect(americano!.sizes?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("every product passes Zod schema validation", () => {
    for (const p of products) {
      const result = ProductSchema.safeParse(p);
      expect(result.success, `Product ${p.id} failed validation`).toBe(true);
    }
  });

  it("cheapest is $5.00 (Americano), most expensive is $22.00 (The Rockstar)", () => {
    const prices = products.map((p) => p.price).sort((a, b) => a - b);
    expect(prices[0]).toBe(5.0);
    expect(prices[prices.length - 1]).toBe(22.0);
  });
});
