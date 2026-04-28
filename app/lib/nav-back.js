/**
 * Vector | WA — back-navigation helper (Thread 23).
 *
 * Single source of truth for the "← Back" affordance on detail pages.
 * Calls router.back() when the tab has SPA history; otherwise pushes the
 * caller-supplied fallback path. Audit-derived label pattern (Thread 20):
 * detail pages use this with a layer-appropriate fallback ('/' for public,
 * '/c/[slug]' for the client portal mirror). Sub-routes with a single
 * canonical parent (e.g. /committees/[slug]) intentionally do NOT use this
 * — they push to their parent route directly.
 *
 * Avoids document.referrer reads — Thread 23 spec explicitly forbids that
 * (referrer is fragile across SPA navigation and PWA cold starts).
 *
 * Usage in a client component:
 *   import { goBackOrFallback } from '../../lib/nav-back'
 *   <button onClick={() => goBackOrFallback(router, '/')}>← Back</button>
 *
 * Usage in a server component (via BackChip wrapper):
 *   <BackChip label="Back" fallbackPath={`/c/${client.slug}`} />
 */
export function goBackOrFallback(router, fallback = '/') {
  if (typeof window === 'undefined') return
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push(fallback)
  }
}