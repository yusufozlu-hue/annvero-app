import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/securityHeaders";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // Ensure pdf.js legacy build + canvas land in serverless traces (Vercel).
  outputFileTracingIncludes: {
    "/api/bank-pdf/parse": [
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/pdfjs-dist/legacy/build/**/*",
    ],
    "/api/bank-ocr/run": [
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/@napi-rs/canvas/**/*",
    ],
  },
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        // Classic analyze worker — explicit JS MIME for public/workers IIFE.
        source: "/workers/:path*",
        headers: [
          {
            key: "Content-Type",
            value: "text/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
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
