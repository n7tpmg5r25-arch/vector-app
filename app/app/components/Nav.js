'use client'
import { usePathname, useRouter } from 'next/navigation'
import { isInterimPeriod } from '../../lib/session-config'

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
  // During active session, show Hearings as before
  {
    get path() { return (typeof window !== 'undefined' && isInterimPeriod()) ? '/committees' : '/hearings' },
    get label() { return (typeof window !== 'undefined' && isInterimPeriod()) ? 'Cmtes' : 'Hearings' },
    icon: (active) => {
      const interim = typeof window !== 'undefined' && isInterimPeriod()
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

  // Thread 7: layout (orientation, position, sizing) is fully owned by
  // .v-nav / .v-nav__btn in globals.css so the nav can swap from
  // bottom-tab (mobile) to top-bar (desktop) via media queries. We keep
  // active-state visual cues inline because they depend on per-render
  // data (which path is current).
  return (
    <nav className="v-nav">
      {NAV.map(({ path, label, icon }) => {
        const active = pathname === path || (path !== '/' && pathname.startsWith(path))
        return (
          <button
            key={path}
            onClick={() => router.push(path)}
            className="v-nav__btn"
            style={{
              opacity: active ? 1 : 0.5,
              filter: active ? 'drop-shadow(0 0 6px rgba(184,151,90,0.3))' : 'none',
            }}
          >
            {icon(active)}
            <span
              className="v-nav__label"
              style={{
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--teal)' : 'var(--text-muted)',
              }}
            >{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
