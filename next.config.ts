import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // keep CLAUDE.md ours: `next dev` otherwise appends a managed block when it detects an agent
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          // the POS scanner needs the camera; nothing else does
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        // the service worker must never be served stale, or a fixed bug lives on at the show
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
