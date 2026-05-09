import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Thread 71 (2026-05-07) — /how-it-works renamed to /install. The old
  // route was a 4-section explainer that grew redundant with /about §1 and
  // /methodology; only the install flow (Thread 61 PR #93) had unique value
  // there. Renamed to match the page's actual purpose.
  //
  // Permanent (308) preserves bookmarks + SEO link-juice from the old URL
  // — search engines roll the link equity into /install. Old saved
  // screenshots and chat references continue to resolve.
  async redirects() {
    return [
      {
        source: '/how-it-works',
        destination: '/install',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
