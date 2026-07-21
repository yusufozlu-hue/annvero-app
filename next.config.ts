import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/securityHeaders";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({ isDev }),
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/hesaplama-araclari/kidem-ihbar",
        destination: "/ik-personel/kidem-ihbar",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
