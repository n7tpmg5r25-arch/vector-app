/**
 * /c/[slug] — Team portal segment layout
 *
 * Thread 44 (2026-04-30): Brand v1.2 adopted Vector | WA as the only brand.
 * The legacy display-font load this layout used to ship was the only thing
 * that justified its existence — Karla, Playfair Display, and DM Mono are
 * all loaded globally by app/app/globals.css and serve the team portal
 * directly.
 *
 * The layout file is intentionally kept (not deleted) as a thin segment
 * pass-through. Next.js segment layouts have routing implications, and
 * keeping this stub avoids any subtle change in how route groups resolve
 * for /c/[slug] and /c/[slug]/bill/[id]. Future portal-scoped concerns
 * (preload hints, segment metadata) can land here without re-creating it.
 *
 * Reference: BRAND_COMPLIANCE_PLAN.md § Thread 44, Brand Guide v1.2 §02.
 */

export default function TeamPortalSegmentLayout({ children }) {
  return <>{children}</>
}
