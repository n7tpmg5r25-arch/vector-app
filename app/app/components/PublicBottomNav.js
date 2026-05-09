'use client'
/**
 * PublicBottomNav — Vector | WA Thread 29 (2026-04-27)
 *
 * Globally-mounted bottom-nav rendered ONLY for anonymous visitors on the
 * public-layer surfaces. Closes the cross-page wayfinding gap surfaced by
 * the Thread 20 persona audit (Sam/Lobbyist + Jordan/Journalist had to
 * back-button their way around because authed users got Nav.js but anon
 * users got nothing below the fold).
 *
 * ─── Layer matrix (G6 — globally-mounted layer discipline) ─────────
 *   role === 'public'  → render the 4-tab bottom nav (Search /
 *                        Committees / Members / Outcomes-or-Hearings).
 *   role === 'owner'   → suppress. The existing authed Nav.js IS the
 *                        owner bottom nav; doubling would render two
 *                        fixed-bottom bars stacked on top of each other.
 *   role === 'client'  → suppress. The /c/[slug] segment layout owns
 *                        the client portal chrome.
 *   loading            → suppress. Mirrors the Thread 15.2 pattern that
 *                        prevents PublicNav / Nav flicker before auth
 *                        resolves.
 *
 * ─── Path gate ─────────────────────────────────────────────────────
 * Even for role='public', this nav only renders on the proxy.js public-
 * layer allowlist (or '/disclaimers', which is always-public). This
 * keeps the bar off /login, /auth/callback, and any internal-only route
 * a logged-out visitor might hit. The allowlist is a deliberate copy of
 * proxy.js#isPublicLayerRoute — if proxy.js gains a route, mirror it
 * here so the two never disagree on what 'public-layer' means.
 *
 * ─── Hydration ─────────────────────────────────────────────────────
 * Tab-4's Outcomes ↔ Hearings swap uses isInterimPeriod() — a pure date
 * check from session-config.js. SSR + CSR agree (Thread 15.2 lesson:
 * never wrap interim/session checks in `typeof window !== 'undefined'`
 * because that mismatches on hydration).
 *
 * ─── Visual ────────────────────────────────────────────────────────
 * Mirrors authed Nav.js bottom-nav chrome 1:1 — same fixed positioning,
 * 480px max-width column, 0.92 alpha + 16px backdrop-blur surface, brass
 * active-state filter. Mobile-only (no @media breakpoints — see CLAUDE.md
 * "Mobile-only by design" rule). The visual equivalence is intentional:
 * the public surface should feel like the same product as the authed app.
 *
 * G5 cohort literal: not touched.
 */

import { usePathname, useRouter } from 'next/navigation'
import { useViewer } from '../../lib/viewer-capabilities'
import { isInterimPeriod } from '../../lib/session-config'

// Mirrors proxy.js#isPublicLayerRoute + the always-public /disclaimers.
// Keep in sync with proxy.js. If proxy.js adds a route, add it here.
function isPublicSurface(pathname) {
  if (pathname === '/') return true
  if (pathname.startsWith('/bill/')) return true
  if (pathname === '/search') return true
  if (pathname === '/committees') return true
  if (pathname.startsWith('/committees/')) return true
  if (pathname === '/members') return true
  if (pathname === '/methodology') return true
  if (pathname === '/outcomes') return true
  if (pathname === '/hearings') return true
  if (pathname === '/install') return true
  if (pathname === '/about') return true
  if (pathname === '/roadmap') return true
  if (pathname === '/disclaimers') return true
  return false
}

// 4-tab anon nav. Tabs 1-3 are static. Tab 4 swaps Outcomes ↔ Hearings
// the same way authed Nav.js swaps Cmtes ↔ Hearings — mirror the SWAP
// pattern (interim vs session), not the labels (the public column has
// 4 tabs vs the authed column's 5, so labels diverge intentionally).
const TABS = [
  {
    path: '/search',
    label: 'Search',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
  {
    path: '/committees',
    label: 'Cmtes',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18"/>
        <path d="M5 21V7l7-4 7 4v14"/>
        <path d="M9 21v-6h6v6"/>
        <path d="M9 9h1"/><path d="M14 9h1"/>
        <path d="M9 13h1"/><path d="M14 13h1"/>
      </svg>
    ),
  },
  {
    path: '/members',
    label: 'Members',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    // Tab-4 swap: Outcomes during interim, Hearings during session.
    // No `typeof window` guard — isInterimPeriod() is pure-date so SSR
    // and CSR agree (Thread 15.2 hydration-mismatch fix).
    get path() { return isInterimPeriod() ? '/outcomes' : '/hearings' },
    get label() { return isInterimPeriod() ? 'Outcomes' : 'Hearings' },
    icon: (active) => {
      const interim = isInterimPeriod()
      return interim ? (
        // Trophy / outcomes icon
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9a6 6 0 0 0 12 0V3H6z"/>
          <path d="M6 5H3v3a3 3 0 0 0 3 3"/>
          <path d="M18 5h3v3a3 3 0 0 1-3 3"/>
          <path d="M9 21h6"/>
          <path d="M12 15v6"/>
        </svg>
      ) : (
        // Calendar / hearings icon (mirrors authed Nav.js exactly)
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <circle cx="8" cy="15" r="1" fill={active ? 'var(--teal)' : 'var(--text-muted)'}/>
          <circle cx="12" cy="15" r="1" fill={active ? 'var(--teal)' : 'var(--text-muted)'}/>
          <circle cx="16" cy="15" r="1" fill={active ? 'var(--teal)' : 'var(--text-muted)'}/>
        </svg>
      )
    },
  },
]

export default function PublicBottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { capabilities, loading } = useViewer()

  // ─── G6 layer gates ──────────────────────────────────────────────
  if (loading) return null
  if (capabilities.role !== 'public') return null
  if (!pathname || !isPublicSurface(pathname)) return null

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: '50%',
      transform: 'translateX(-50%)',
      width: '100%', maxWidth: 480,
      background: 'rgba(14,16,20,0.92)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderTop: '1px solid var(--border)',
      padding: '10px 4px 24px',
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      zIndex: 100,
    }}>
      {TABS.map(({ path, label, icon }) => {
        const active = pathname === path || (path !== '/' && pathname.startsWith(path))
        return (
          <button
            key={label}
            onClick={() => router.push(path)}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
              background: 'none', border: 'none',
              padding: '4px 8px',
              transition: 'opacity 0.15s',
              minWidth: 52,
              opacity: active ? 1 : 0.5,
              filter: active ? 'drop-shadow(0 0 6px rgba(184,151,90,0.3))' : 'none',
              cursor: 'pointer',
            }}
          >
            {icon(active)}
            <span style={{
              fontSize: 9,
              letterSpacing: '0.03em',
              fontFamily: 'var(--font-body)',
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--teal)' : 'var(--text-muted)',
            }}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
