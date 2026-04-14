import productsData from "@/data/products.json";
import type { Product } from "@/lib/schemas";

const products: Product[] = productsData as Product[];

export type ProductCategory = "smoothies" | "coffee_tonics" | "pastries";

export function getAllProducts(): Product[] {
  return products;
}

export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function searchProducts(query: string): Product[] {
  const lower = query.toLowerCase();
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      p.display_name.toLowerCase().includes(lower) ||
      p.search_keywords.some((kw) => kw.toLowerCase().includes(lower)) ||
      p.ingredients.some((ing) => ing.toLowerCase().includes(lower))
  );
}

export function getProductsByCategory(category: ProductCategory): Product[] {
  return products.filter((p) => p.category === category);
}
