import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("declares standalone display for iPad Home Screen", () => {
    const m = manifest();
    // iPadOS silently falls back to standalone from fullscreen; we
    // commit to the achievable value so `display-mode: standalone`
    // CSS queries match when launched from Home Screen.
    expect(m.display).toBe("standalone");
    expect(m.orientation).toBe("portrait");
  });

  it("uses the avatar-stage dark palette for theme and background", () => {
    const m = manifest();
    expect(m.theme_color).toBe("#1A1714");
    expect(m.background_color).toBe("#1A1714");
  });

  it("ships 192 and 512 icons with the expected paths", () => {
    const m = manifest();
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of m.icons ?? []) {
      expect(icon.src.startsWith("/icons/")).toBe(true);
      expect(icon.type).toBe("image/png");
    }
  });

  it("names the app clearly for investors reading the Home Screen", () => {
    const m = manifest();
    expect(m.name).toMatch(/walletta/i);
    expect(m.short_name).toBe("Walletta");
    expect(m.start_url).toBe("/");
  });
});
