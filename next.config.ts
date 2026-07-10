import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
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
