'use client'
/**
 * PublicNav — Phase 12 Batch 4
 *
 * Top bar shown to anonymous visitors when the public layer is enabled.
 * Per Phase 12 plan §6 and the v4.6 B6 brand anchor:
 *   - Wordmark left (vector-wa-primary.svg, §10 lockup)
 *   - "Sign in" CTA right (Brass accent)
 *   - Vector | WA palette only — no Shorepine firm Forest/Parchment here
 *   - Karla body (already site-wide via globals.css)
 *
 * NOT a replacement for app/app/components/Nav.js. The owner bottom-icon
 * Nav stays unchanged for logged-in viewers. PublicNav is mounted only
 * inside PublicHome (and, in Batches 5-7, on the other public surfaces).
 */
import Link from 'next/link'

export default function PublicNav() {
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        width: '100%',
        background: 'rgba(14, 16, 20, 0.92)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: 'var(--font-body)',
      }}
    >
      {/* §10 lockup — primary SVG, no composite with Shorepine firm mark */}
      <Link
        href="/"
        aria-label="Vector | WA — home"
        style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
      >
        <img
          src="/logos/vector-wa-primary.svg"
          alt="Vector | WA"
          style={{
            height: 36,
            width: 'auto',
            display: 'block',
            filter: 'drop-shadow(0 0 12px rgba(184,151,90,0.18))',
          }}
        />
      </Link>

      <Link
        href="/login"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--bg)',
          background: 'var(--teal)',
          border: '1px solid var(--teal)',
          borderRadius: 6,
          textDecoration: 'none',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--teal-bright)'
          e.currentTarget.style.borderColor = 'var(--teal-bright)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--teal)'
          e.currentTarget.style.borderColor = 'var(--teal)'
        }}
      >
        Sign in
      </Link>
    </nav>
  )
}
