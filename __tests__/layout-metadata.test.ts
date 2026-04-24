import { describe, it, expect, vi } from "vitest";

// next/font/google evaluates eagerly at module load and needs the Next.js
// runtime to fetch + subset the font files. Stub with a factory that
// returns the minimal `{ variable }` shape the layout expects.
vi.mock("next/font/google", () => ({
  Cormorant_Garamond: () => ({ variable: "--font-display" }),
  DM_Sans: () => ({ variable: "--font-sans" }),
}));

import { metadata, viewport } from "@/app/layout";

describe("app/layout metadata — Home Screen install", () => {
  it("points at the Next.js-served manifest", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
  });

  it("declares apple-mobile-web-app-capable + black-translucent", () => {
    const apple = metadata.appleWebApp as {
      capable: boolean;
      statusBarStyle: string;
      title: string;
    };
    // `capable: true` is what tells Safari to drop the URL bar when
    // launched from the Home Screen. `black-translucent` lets us paint
    // behind the status bar; env(safe-area-inset-top) keeps content
    // clear of the notch region.
    expect(apple.capable).toBe(true);
    expect(apple.statusBarStyle).toBe("black-translucent");
    expect(apple.title).toBe("Walletta");
  });

  it("wires an apple-touch-icon at 180x180", () => {
    const icons = metadata.icons as {
      apple: string;
      icon: { url: string; sizes: string }[];
    };
    expect(icons.apple).toBe("/icons/apple-touch-icon.png");
    expect(icons.icon[0]?.sizes).toBe("192x192");
  });

  it("viewport themeColor matches the manifest theme", () => {
    expect(viewport.themeColor).toBe("#1A1714");
    expect(viewport.viewportFit).toBe("cover");
  });
});
