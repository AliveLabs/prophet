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
  // /example-brief is embedded in a modal iframe on the marketing site. This header WHITELISTS
  // who may frame it (ourselves, the marketing domain, and localhost for dev) -- the app sends no
  // frame headers anywhere else, so this narrows rather than opens. Scoped to the one route on
  // purpose: an app-wide frame policy is a separate security decision.
  async headers() {
    return [
      {
        source: "/example-brief",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://getticket.ai https://www.getticket.ai http://localhost:*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
