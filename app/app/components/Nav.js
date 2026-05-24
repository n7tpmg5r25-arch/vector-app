'use client'
import { usePathname, useRouter } from 'next/navigation'
import { isInterimPeriod } from '../../lib/session-config'
import HamburgerButton from './HamburgerButton'

const NAV = [
  {
    path: '/', label: 'Home',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'var(--teal)' : 'none'}
        stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    path: '/watchlist', label: 'Watchlist',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'var(--gold)' : 'none'}
        stroke={active ? 'var(--gold)' : 'var(--text-muted)'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    path: '/search', label: 'Search',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
  // UI.1.3: During interim, show Committees instead of Hearings (hearings empty, outcomes merged into Search)
  // During active session, show Hearings as before.
  // Thread 15.2: removed `typeof window !== 'undefined'` guard. isInterimPeriod()
  // is a pure date comparison from session-config.js — server and client agree.
  // The guard was producing an SSR/CSR mismatch (server rendered "Hearings",
  // client hydrated to "Cmtes" during interim), which read as a per-page flicker.
  {
    get path() { return isInterimPeriod() ? '/committees' : '/hearings' },
    get label() { return isInterimPeriod() ? 'Committees' : 'Hearings' },
    icon: (active) => {
      const interim = isInterimPeriod()
      return interim ? (
        // Building icon for Committees
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18"/>
          <path d="M5 21V7l7-4 7 4v14"/>
          <path d="M9 21v-6h6v6"/>
          <path d="M9 9h1"/><path d="M14 9h1"/>
          <path d="M9 13h1"/><path d="M14 13h1"/>
        </svg>
      ) : (
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
  {
    path: '/members', label: 'Members',
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
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <>
      {/* Thread 55 (2026-05-01) -- top-left hamburger trigger for the
          global SideDrawer. Rendered as a fixed-position element anchored
          to the top-left of the 480px mobile column so the bottom-tab Nav
          retains its existing chrome. The drawer itself is mounted in
          app/app/layout.tsx as a sibling to Footer.

          Top-left placement mirrors LinkedIn / Gmail / Notion convention.
          The button stays out of the way of in-page sticky headers (e.g.
          PublicNav top bar on shared public/owner pages) by sitting above
          page content but below the drawer overlay (zIndex 90 -- drawer
          uses 998/999).

          Hotfix 2026-05-01: clamp `left` with max() so it never goes
          negative on viewports narrower than the 480px column (iPhone
          screens are 375-430px wide; the raw calc(50% - 240px + 6px)
          resolves to -19 to -47px on iPhone, anchoring the button half
          off-screen to the left). max(6px, ...) keeps the button inside
          the column on every viewport. `top` adds env(safe-area-inset-top)
          so the button sits below the iOS status bar / notch when the
          app is installed as a PWA. */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          left: 'max(6px, calc(50% - 240px + 6px))',
          width: 40,
          zIndex: 90,
          pointerEvents: 'auto',
        }}
      >
        <HamburgerButton />
      </div>

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
      {NAV.map(({ path, label, icon }) => {
        const active = pathname === path || (path !== '/' && pathname.startsWith(path))
        return (
          <button
            key={path}
            onClick={() => router.push(path)}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
              background: 'none', border: 'none',
              padding: '4px 8px',
              transition: 'opacity 0.15s',
              minWidth: 52,
              opacity: active ? 1 : 0.5,
              filter: active ? 'drop-shadow(0 0 6px rgba(184,151,90,0.3))' : 'none',
            }}
          >
            {icon(active)}
            <span
              style={{
                fontSize: 9,
                letterSpacing: '0.03em',
                fontFamily: 'var(--font-body)',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--teal)' : 'var(--text-muted)',
              }}
            >{label}</span>
          </button>
        )
      })}
    </nav>
    </>
  )
}
