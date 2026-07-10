import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // T159 perf: tree-shake barrel imports so each route ships only the icons /
  // helpers it actually uses instead of the whole package. lucide-react is the
  // main beneficiary (hundreds of icons behind a single import).
  experimental: {
    optimizePackageImports: ['lucide-react', '@supabase/supabase-js'],
  },

  // AUDIT-6 S1 (2026-07-09): pin the workspace root. Two lockfiles (repo
  // root + app/) made Turbopack guess the root and warn on every build.
  turbopack: {
    root: __dirname,
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

  // AUDIT-4 S2 (2026-07-08): baseline security response headers. HSTS is
  // already supplied by Vercel; these four are additive and low-risk. A full
  // Content-Security-Policy is deferred to its own thread (the app's inline
  // styles need a nonce strategy before a strict CSP is safe).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
