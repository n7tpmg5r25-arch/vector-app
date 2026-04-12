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
    <div style={{
      width: '100%',
      background: 'rgba(184,151,90,0.08)',
      borderBottom: '1px solid rgba(184,151,90,0.25)',
      padding: '7px 16px',
      fontSize: 12,
      color: 'var(--gold)',
      fontFamily: 'var(--font-body)',
      textAlign: 'center',
      lineHeight: 1.4,
      position: 'sticky',
      top: 0,
      zIndex: 200,
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    }}>
      Viewing {session} session (historical).{' '}
      <span
        onClick={() => {
          setSession(current)
          if (typeof window !== 'undefined') window.location.reload()
        }}
        style={{
          textDecoration: 'underline',
          cursor: 'pointer',
          fontWeight: 600,
          marginLeft: 4,
        }}
      >
        Switch to current session
      </span>
    </div>
  )
}
