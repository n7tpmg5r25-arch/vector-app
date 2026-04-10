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
  // 6B.3: During interim, show Outcomes instead of Hearings (hearings table is empty)
  {
    get path() { return (typeof window !== 'undefined' && isInterimPeriod()) ? '/outcomes' : '/hearings' },
    get label() { return (typeof window !== 'undefined' && isInterimPeriod()) ? 'Outcomes' : 'Hearings' },
    icon: (active) => {
      const interim = typeof window !== 'undefined' && isInterimPeriod()
      return interim ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke={active ? 'var(--teal)' : 'var(--text-muted)'} strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
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
    <nav style={{
      position: 'fixed', bottom: 0, left: '50%',
      transform: 'translateX(-50%)',
      width: '100%', maxWidth: 480,
      background: 'rgba(11,26,18,0.92)',
      backdropFilter: 'blur(16px)',
      borderTop: '1px solid var(--border)',
      padding: '10px 4px 24px',
      display: 'flex', justifyContent: 'space-around',
      alignItems: 'center',
      zIndex: 100,
    }}>
      {NAV.map(({ path, label, icon }) => {
        const active = pathname === path || (path !== '/' && pathname.startsWith(path))
        return (
          <button
            key={path}
            onClick={() => router.push(path)}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
              background: 'none', border: 'none',
              padding: '4px 8px',
              opacity: active ? 1 : 0.5,
              transition: 'opacity 0.15s',
              minWidth: 52,
              filter: active ? 'drop-shadow(0 0 6px rgba(45,107,69,0.3))' : 'none',
            }}
          >
            {icon(active)}
            <span style={{
              fontSize: 9, fontWeight: active ? 600 : 400,
              color: active ? 'var(--teal)' : 'var(--text-muted)',
              letterSpacing: '0.03em',
              fontFamily: 'var(--font-body)',
            }}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
