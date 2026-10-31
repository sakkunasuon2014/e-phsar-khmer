import { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// Derive the Supabase Storage host from the env so next/image can optimize
// public bucket URLs. Evaluated at build time (server-side only); the host is
// already visible in <img src> URLs delivered to the browser — no secret leak.
const supabaseHost = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).hostname
  : null;

// A per-build stamp for the devices page ("Browser 2026.10.20"). Evaluated
// when the config is loaded — at image build time in Docker, at server start
// in dev. An explicit env var wins so CI can pin the release date.
const buildStamp = new Date().toISOString().slice(0, 10).replace(/-/g, ".");

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || buildStamp,
  },
  // Emits .next/standalone: a minimal server.js plus only the node_modules it
  // traces, which is what apps/web/Dockerfile ships. Vercel ignores it.
  output: "standalone",
  experimental: {
    // Server actions default to a 1 MB body. Avatar/cover uploads (backend cap
    // 5 MB) and feedback (up to 6 images × 5 MB) pass Files through actions,
    // so anything over 1 MB was rejected before reaching the backend.
    serverActions: { bodySizeLimit: "32mb" },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    qualities: [25, 50, 75, 100],
    remotePatterns: [
      { protocol: "https", hostname: "gikdqkuogotpoydbfonn.supabase.co" },
      ...(supabaseHost
        ? [
            {
              protocol: "https" as const,
              hostname: supabaseHost,
              pathname: "/**",
            },
          ]
        : []),
    ],
  },
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.lhr.life",
    "*.localhost:3001",
    "admin.localhost:3001",
    "backoffice.localhost:3001",
    "phsar-backoffice.localhost:3001",
    "phsar-admin.localhost:3001",
  ],
};

export default withNextIntl(nextConfig);
