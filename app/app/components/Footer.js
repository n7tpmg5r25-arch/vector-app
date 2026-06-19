"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import { useViewer } from '../../lib/viewer-capabilities'

/**
 * Global app footer -- Option B Utility Footer (Thread 33, 2026-04-28).
 *
 * Two-row layout (mobile-only, 480px column):
 *
 *   Row 1: byline (top) + freshness signal (bottom).
 *   Row 2: utility links (top) + role-branched right slot (bottom):
 *            * public  -> small brass launch pill "Public launch . mid 2027"
 *            * owner   -> null (Brand v1.2 dropped firm attribution; Thread 43)
 *            * client  -> null (suppressed; client portal pages own their
 *                         per-page footer)
 *
 * Layer-correctness (Universal Guardrail G6 -- globally mounted):
 *   Footer.js is mounted in app/app/layout.tsx and renders on every route
 *   across all three viewer layers (public, owner, client). The
 *   viewer-aware right-slot branch preserves Thread 19.1's pattern --
 *   relocated from its own bottom row to Row 2's right column, but the
 *   public-vs-internal brand split is intact.
 *
 * Row 2 adds Methodology + How it works to the link rail. Both already
 * existed in the top-nav (PublicNav for anon, Nav for owner) but had no
 * footer entry point -- a trust signal added per Thread 33 spec.
 *
 * Thread 58 update (2026-05-01) -- Row 2 now renders for role==='public'
 * only. Owner + client viewers get a leaner footer (Row 1: byline + freshness
 * only) and reach the four reference pages (Disclaimers / About /
 * Methodology / How it works) via the SideDrawer's Reference section. Anon
 * viewers keep the link rail for ambient discovery + SEO link-juice into
 * the public-allowlist routes ahead of the mid-2027 launch.
 *
 * Thread 65 follow-up (2026-05-03) -- Row 2 also suppressed on /login.
 * The login page now carries its own LEARN MORE CTA pair (Methodology +
 * About) directly under the sign-in card, so the footer link rail below
 * it would be redundant chrome. /login keeps Row 1 (byline + freshness)
 * for the same reason every other surface does.
 *
 * Thread 58.6 (2026-05-01) -- "Refreshed nightly" replaced with a real sync
 * timestamp pulled from sync_log.MAX(ran_at) WHERE bills_updated > 0
 * (skips daily-snapshot safety-net rows that don't actually pull fresh
 * data). Format Pacific-zone relative + absolute. Stale-aware: when last
 * sync >25h ago, copy + color shift to Rust (#c44730) signaling a missed
 * nightly run. Lobbyists planning around 8am hearings need this to be
 * real and decision-grade per Brand Guide §05.
 */

// Time thresholds (ms) for the sync-timestamp staleness ladder.
const FRESH_MS    = 25 * 60 * 60 * 1000  // <=25h: green/normal
const STALE_MS    = 49 * 60 * 60 * 1000  // 25-49h: amber-warn (still in normal copy)
// >49h: Rust + "Last sync N hours ago" copy (a missed nightly is the alarm)

// Time-zone-aware formatter for the Pacific timestamp.
function formatSyncTimestamp(ranAtIso) {
  if (!ranAtIso) return null
  const ranAt = new Date(ranAtIso)
  if (isNaN(ranAt.getTime())) return null

  const now = new Date()
  const ageMs = now.getTime() - ranAt.getTime()
  const ageHours = Math.floor(ageMs / (60 * 60 * 1000))

  // Time-of-day in Pacific (handles PST/PDT automatically).
  const time = ranAt.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  // Day delta in Pacific calendar terms.
  const ranAtPacific = new Date(ranAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const nowPacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const dayDelta = Math.floor(
    (nowPacific.setHours(0, 0, 0, 0) - new Date(ranAtPacific).setHours(0, 0, 0, 0)) / (24 * 60 * 60 * 1000)
  )

  let copy
  let stale = ageMs > FRESH_MS

  // Always compute the absolute date label (e.g. "May 3"). Thread 64
  // (2026-05-03): Colin asked that "today" + "yesterday" not look stale
  // by themselves -- pinning the actual date alongside the relative
  // word lets a viewer see at-a-glance what day "today" actually is.
  const dateLabel = ranAt.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
  })

  if (ageMs > STALE_MS) {
    // >49h: missed nightly. Hours-only readout, signaled in Rust.
    copy = `Last sync · ${ageHours} hours ago`
  } else if (dayDelta === 0) {
    copy = `Refreshed today (${dateLabel}) · ${time}`
  } else if (dayDelta === 1) {
    copy = `Refreshed yesterday (${dateLabel}) · ${time}`
  } else {
    copy = `Refreshed ${dateLabel} · ${time}`
  }

  return { copy, stale }
}

export default function Footer() {
  const { capabilities, loading } = useViewer()
  const role = capabilities?.role
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'
  const [freshness, setFreshness] = useState(null)

  // Pull the real sync timestamp on mount. One-shot, no polling — users who
  // want a fresher read can refresh the page (matches our nightly cadence).
  useEffect(() => {
    let mounted = true
    const supabase = createBrowserClient()
    supabase
      .from('sync_log')
      .select('ran_at')
      .gt('bills_updated', 0)
      .order('ran_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (!mounted) return
        if (error || !data || data.length === 0) {
          setFreshness(null)
          return
        }
        setFreshness(formatSyncTimestamp(data[0].ran_at))
      })
    return () => { mounted = false }
  }, [])

  // Row 2 right slot -- viewer-branched per G6 (Thread 19.1 pattern).
  let rightSlot = null
  if (!loading) {
    if (role === 'public') {
      rightSlot = (
        <span
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            border: '1px solid #b8975a',
            borderRadius: 999,
            color: '#d4b47a',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          Public launch &middot; mid 2027
        </span>
      )
    }
    // role === 'owner' | 'client' -> rightSlot stays null
    //   (Brand v1.2 dropped firm attribution; client portal pages render
    //   their own per-page footer.)
  }

  const linkStyle = {
    color: '#d4b47a',
    textDecoration: 'none',
  }

  return (
    <footer
      style={{
        borderTop: '1px solid #232530',
        background: '#0e1014',
        padding: '16px 24px 90px 24px',
        fontFamily: 'var(--font-karla, Karla, sans-serif)',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#7a8090',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: 460,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Row 1 -- byline + freshness signal */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span style={{ color: '#9aa0b0' }}>
            Vector | WA &mdash; open-source bill intelligence for Washington State
          </span>
          <span
            style={{
              color: freshness?.stale ? '#c44730' : 'var(--text-faint)',
              fontSize: 11,
              letterSpacing: '0.02em',
              fontStyle: 'normal',
              fontFamily: 'var(--font-mono, "DM Mono", monospace)',
            }}
          >
            {freshness?.copy || 'Refreshed nightly'}
          </span>
        </div>

        {/* Row 2 -- utility links + role-branched right slot.
            Thread 58: anon-only. Owner + client viewers reach the four
            reference pages via the SideDrawer's Reference section.
            Thread 65 follow-up (2026-05-03): also suppressed on /login --
            the LoginPage now ships its own LEARN MORE CTA pair, so the
            Row 2 link rail would be redundant chrome below it. */}
        {role === 'public' && !isLoginPage && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              paddingTop: 10,
              borderTop: '1px solid #1e2028',
            }}
          >
            <span>
              <Link href="/disclaimers" style={linkStyle}>
                Disclaimers
              </Link>
              {' · '}
              <Link href="/about" style={linkStyle}>
                About
              </Link>
              {' · '}
              <Link href="/roadmap" style={linkStyle}>
                Roadmap
              </Link>
              {' · '}
              <Link href="/methodology" style={linkStyle}>
                Methodology
              </Link>
              {' · '}
              <Link href="/install" style={linkStyle}>
                Install
              </Link>
            </span>
            {rightSlot && <span>{rightSlot}</span>}
          </div>
        )}
      </div>
    </footer>
  )
}
