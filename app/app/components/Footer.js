"use client"

import Link from 'next/link'
import { useViewer } from '../../lib/viewer-capabilities'

/**
 * Global app footer -- Option B Utility Footer (Thread 33, 2026-04-28).
 *
 * Two-row layout (mobile-only, 480px column):
 *
 *   Row 1: byline (top) + "Refreshed nightly" (bottom).
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
 * Thread 56.1 update (2026-05-01) -- Row 2 now renders for role==='public'
 * only. Owner + client viewers get a leaner footer (Row 1: byline + freshness
 * only) and reach the four reference pages (Disclaimers / About /
 * Methodology / How it works) via the SideDrawer's Reference section. Anon
 * viewers keep the link rail for ambient discovery + SEO link-juice into
 * the public-allowlist routes ahead of the mid-2027 launch.
 */
export default function Footer() {
  const { capabilities, loading } = useViewer()
  const role = capabilities?.role

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
            Vector | WA &mdash; bill intelligence for Washington State
          </span>
          <span
            style={{
              color: '#5a6070',
              fontSize: 11,
              letterSpacing: '0.02em',
            }}
          >
            Refreshed nightly
          </span>
        </div>

        {/* Row 2 -- utility links + role-branched right slot.
            Thread 56.1: anon-only. Owner + client viewers reach the four
            reference pages via the SideDrawer's Reference section. */}
        {role === 'public' && (
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
              <Link href="/methodology" style={linkStyle}>
                Methodology
              </Link>
              {' · '}
              <Link href="/how-it-works" style={linkStyle}>
                How it works
              </Link>
            </span>
            {rightSlot && <span>{rightSlot}</span>}
          </div>
        )}
      </div>
    </footer>
  )
}
