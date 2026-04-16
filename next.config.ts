import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the current ngrok tunnel + local LAN during dev so HMR works
  // when the iPad loads the app over the tunnel.
  allowedDevOrigins: [
    "prettied-aron-migrative.ngrok-free.dev",
    "192.168.1.213",
  ],
};

export default nextConfig;
