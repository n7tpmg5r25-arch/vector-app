'use client'
/**
 * SessionBanner — Phase 7U.5
 *
 * Global slim strip that appears at the top of every page whenever the
 * user is viewing a historical biennium (not the current session). The
 * session picker lives on the home page header, but useSession() is
 * localStorage-backed and sticky across navigation — so without this
 * banner, a user could land on /outcomes or /search and silently be
 * looking at 2021-22 data without any visual cue.
 *
 * Clicking "Switch to current session" resets useSession back to the
 * live biennium and reloads the current page so fresh data loads.
 */
import { useEffect, useState } from 'react'
import { useSession } from '../../lib/useSession'
import { getCurrentSession } from '../../lib/session-config'

export default function SessionBanner() {
  const [session, setSession] = useSession()
  // Phase 7U.5 hotfix: wait for client-side mount before deciding whether to
  // render. useSession's initializer returns getCurrentSession() during SSR
  // (no window) but reads localStorage on the client — that mismatch can
  // cause React 18 to discard the client value during hydration and the
  // banner never appears. Gating on `mounted` makes this safe.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const current = getCurrentSession()

  if (!mounted || session === current) return null

  return (
    // Normal-flow block — no sticky/fixed positioning. Renders above all
    // {children} in the root layout so it's always the first thing visible
    // when landing on a page with a historical session selected.
    // Sticky was removed: pages have their own sticky headers at top:0 which
    // would slide over the banner as the user scrolled, and stacking-context
    // quirks from ancestor transforms made zIndex unreliable.
    <div style={{
      width: '100%',
      background: 'rgba(184,151,90,0.14)',
      borderLeft: '3px solid rgba(184,151,90,0.70)',
      borderBottom: '1px solid rgba(184,151,90,0.28)',
      padding: '9px 16px 9px 14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono, "DM Mono", monospace)',
        fontSize: 11,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--gold, #d4b47a)',
        lineHeight: 1.4,
      }}>
        Viewing {session} — historical data
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={() => {
          setSession(current)
          if (typeof window !== 'undefined') window.location.reload()
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            setSession(current)
            if (typeof window !== 'undefined') window.location.reload()
          }
        }}
        style={{
          fontFamily: 'var(--font-mono, "DM Mono", monospace)',
          fontSize: 11,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--gold, #d4b47a)',
          textDecoration: 'underline',
          cursor: 'pointer',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Back to current
      </span>
    </div>
  )
}
