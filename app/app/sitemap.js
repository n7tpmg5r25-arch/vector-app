/**
 * sitemap.js — Vector | WA
 *
 * Thread 82 (2026-05-12): Next.js App Router native sitemap.
 * Returns static always-public routes so Google can discover and index
 * them before the Aug 2027 public launch. Building index equity now means
 * organic traffic at launch — Google needs 6–12 months of crawl time.
 *
 * Route inclusion logic:
 *   INCLUDED — always-public routes (isAlwaysPublic in proxy.js) that have
 *   real content for search engines. Also includes data routes that are
 *   behind the public-layer flag today but will be publicly accessible at
 *   launch — Google discovers them now, indexes content when the flag turns on.
 *
 *   EXCLUDED:
 *     /login            — auth surface, no indexable content
 *     /auth/callback    — utility redirect route
 *     /api/*            — JSON endpoints, not pages
 *     /admin/*          — owner-only, no anon access ever
 *     /c/*              — team portal, RLS-fenced
 *     /bill/[id]        — dynamic; deferred until public layer is live (see
 *                         PHASE_6_PLAN.md Thread 82 biennium-transition note)
 *     /committees/[slug] — dynamic; same deferral
 *     /transparency     — not yet built (Thread 74 blocked)
 *
 * When the public layer goes live (mid 2027): add dynamic /bill/[id] entries
 * by querying Supabase for all bills in the current biennium.
 */

const BASE = 'https://vectorwa.com'

// lastModified is set to build time. Googlebot uses this as a hint only —
// it won't reindex unchanged pages more than crawl budget warrants.
const BUILT_AT = new Date().toISOString()

export default function sitemap() {
  return [
    // ── Core acquisition pages ─────────────────────────────────────────────
    {
      url: `${BASE}/`,
      lastModified: BUILT_AT,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    // Pre-launch front door: anon '/' 307s here; the only indexable
    // marketing page until the public layer flips on (AUDIT-1, 2026-07-02).
    {
      url: `${BASE}/welcome`,
      lastModified: BUILT_AT,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${BASE}/methodology`,
      lastModified: BUILT_AT,
      changeFrequency: 'monthly',
      priority: 0.9,
    },

    // ── Data surfaces (public-layer routes — accessible at launch) ─────────
    {
      url: `${BASE}/outcomes`,
      lastModified: BUILT_AT,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE}/search`,
      lastModified: BUILT_AT,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE}/hearings`,
      lastModified: BUILT_AT,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${BASE}/members`,
      lastModified: BUILT_AT,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE}/committees`,
      lastModified: BUILT_AT,
      changeFrequency: 'monthly',
      priority: 0.7,
    },

    // ── Product + trust pages ──────────────────────────────────────────────
    {
      url: `${BASE}/roadmap`,
      lastModified: BUILT_AT,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE}/changelog`,
      lastModified: BUILT_AT,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${BASE}/install`,
      lastModified: BUILT_AT,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE}/disclaimers`,
      lastModified: BUILT_AT,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]
}
