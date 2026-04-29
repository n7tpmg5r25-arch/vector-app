'use client'
/**
 * PublicNav -- Phase 12 Batch 4 + Thread 24 (2026-04-26)
 *
 * Top bar shown to anonymous visitors when the public layer is enabled.
 *   - Wordmark left (vector-wa-primary logo, Section 10 lockup)
 *   - "How it works" + "About" + "Sign in" right
 *     (Thread 24 added the About link between How it works and Sign in)
 *   - Vector | WA palette only -- no Shorepine firm Forest/Parchment
 *
 * NOT a replacement for the owner Nav. PublicNav is mounted only inside
 * PublicHome and other public surfaces. Per CLAUDE.md G6, this is a top-bar
 * component shared across public routes -- not globally mounted.
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
      <Link
        href="/"
        aria-label="Vector | WA -- home"
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

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
        <NavLink href="/how-it-works">How it works</NavLink>
        <NavLink href="/about">About</NavLink>

        <Link
          href="/login"
          className="vec-cta-primary"
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
      </div>
    </nav>
  )
}

function NavLink({ href, children }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: '0.01em',
        color: 'var(--text-muted)',
        textDecoration: 'none',
        transition: 'color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--teal)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {children}
    </Link>
  )
}