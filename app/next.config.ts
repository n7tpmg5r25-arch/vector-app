import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // T159 perf: tree-shake barrel imports so each route ships only the icons /
  // helpers it actually uses instead of the whole package. lucide-react is the
  // main beneficiary (hundreds of icons behind a single import).
  experimental: {
    optimizePackageImports: ['lucide-react', '@supabase/supabase-js'],
  },

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
      {
        source: '/about',
        destination: '/welcome',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
