import type { MetadataRoute } from "next";

// PWA manifest for the iPad Home Screen install path. iPadOS Safari
// silently falls back from display: "fullscreen" to "standalone" (Apple
// never honoured the fullscreen spec value), so standalone is the best
// we can ask for via the manifest. Combined with the apple-mobile-web-
// app meta tags in app/layout.tsx, launching from the Home Screen drops
// the URL bar, tab strip, and bookmarks bar — the "native app" look
// Temur asked for on 2026-04-24.
//
// The status bar is still visible (Apple does not honour status-bar
// hiding from web apps). Guided Access (Settings → Accessibility) is
// the demo-day workaround for a fully chrome-free presentation.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Walletta AI Cashier",
    short_name: "Walletta",
    description: "AI-powered premium checkout experience",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1A1714",
    theme_color: "#1A1714",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
