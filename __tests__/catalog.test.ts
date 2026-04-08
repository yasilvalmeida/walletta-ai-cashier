import { describe, it, expect } from "vitest";
import {
  getAllProducts,
  getProductById,
  searchProducts,
  getProductsByCategory,
} from "@/lib/catalog";

describe("catalog", () => {
  it("getAllProducts returns 45 items", () => {
    expect(getAllProducts()).toHaveLength(45);
  });

  it("getProductById finds Americano", () => {
    const product = getProductById("coffee-americano");
    expect(product).toBeDefined();
    expect(product!.name).toBe("Americano");
    expect(product!.price).toBe(5.0);
  });

  it("getProductById returns undefined for unknown ID", () => {
    expect(getProductById("nonexistent")).toBeUndefined();
  });

  it("searchProducts finds by name", () => {
    const results = searchProducts("matcha");
    expect(results.length).toBeGreaterThanOrEqual(2); // Matcha Power + Ceremonial Matcha Latte
  });

  it("searchProducts finds by ingredient", () => {
    const results = searchProducts("espresso");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const hasEspresso =
        r.ingredients.some((i) => i.includes("espresso")) ||
        r.search_keywords.some((k) => k.includes("espresso")) ||
        r.name.toLowerCase().includes("espresso");
      expect(hasEspresso).toBe(true);
    }
  });

  it("searchProducts finds by keyword", () => {
    const results = searchProducts("hailey bieber");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("smoothie-strawberry-glaze");
  });

  it("getProductsByCategory filters correctly", () => {
    const smoothies = getProductsByCategory("smoothies");
    const coffee = getProductsByCategory("coffee_tonics");
    expect(smoothies).toHaveLength(23);
    expect(coffee).toHaveLength(22);
  });
});
