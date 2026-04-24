import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PostHog reverse proxy: routes /ingest/* to PostHog's US ingest endpoints
  // so requests aren't blocked by tracker-blocking extensions. Paired with
  // `api_host: '/ingest'` in instrumentation-client.ts. Order matters -- the
  // more specific `/ingest/static/:path*` rule must come first because Next
  // rewrites match top-to-bottom.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
};

export default nextConfig;
