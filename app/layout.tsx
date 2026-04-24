import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Walletta AI Cashier — Erewhon Market",
  description: "AI-powered premium checkout experience",
  manifest: "/manifest.webmanifest",
  // apple-mobile-web-app-capable + black-translucent give the native
  // look when launched from the iPad Home Screen. The status bar is
  // still visible on iPad 17+ regardless of this value (Apple does not
  // honour status-bar hiding from web apps); pair with Guided Access
  // on the demo iPad for a fully chrome-free look.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Walletta",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1A1714",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${dmSans.variable} h-full`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning — browser extensions (Bitdefender /
          BIS, others) inject attributes onto <body> before React
          hydrates, which React normally logs as a hydration mismatch.
          The warning is cosmetic here; the app renders fine. */}
      <body
        className="h-full overflow-hidden antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
