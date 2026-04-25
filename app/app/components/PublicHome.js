'use client'
/**
 * PublicHome — Phase 12 Batch 4
 *
 * The anonymous-visitor home page. Renders only when:
 *   useViewer() returns !user && publicLayerEnabled === true
 * and the proxy.js gate has admitted the request (proxy gate also branches
 * on NEXT_PUBLIC_ENABLE_PUBLIC_LAYER === 'true' for the public allowlist).
 *
 * Layout per Phase 12 plan §6 + B6 brand anchor (Brand v4.6):
 *   - PublicNav (top bar, logo + Sign in)
 *   - Hero band with §10 logo lockup + §02 functional descriptor
 *   - Three entry tiles: Search / Committees / Members
 *   - Bills-moving widget (interim-aware)
 *   - Global Footer (rendered by app/app/layout.tsx) carries the §02 ownership line
 *
 * Brand v4.6 constraints:
 *   - Vector | WA palette only — no Shorepine firm Forest / Parchment here
 *   - Karla body (already site-wide)
 *   - §10 lockup: vector-wa-primary.svg, never composite with the firm mark
 *   - §02 descriptor: "Free, nonpartisan legislative intelligence for Washington State."
 *   - §14 voice: actionable signal, plain English, no overclaim
 */
import Link from 'next/link'
import PublicNav from './PublicNav'
import BillsMovingWidget from './BillsMovingWidget'

export default function PublicHome() {
  return (
    <div style={{ fontFamily: 'var(--font-body)', minHeight: '100vh', paddingBottom: 40 }}>
      <PublicNav />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <header
        style={{
          padding: '56px 20px 36px',
          background: 'linear-gradient(180deg, #0e1014 0%, var(--bg) 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle radial glow — same treatment as the owner home */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(ellipse at 70% 20%, rgba(184,151,90,0.08) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto' }}>
          {/* §10 lockup — primary logo on dark hero */}
          <img
            src="/logos/vector-wa-primary.svg"
            alt="Vector | WA"
            style={{
              height: 88,
              width: 'auto',
              display: 'block',
              marginBottom: 18,
              filter: 'drop-shadow(0 0 24px rgba(184,151,90,0.28))',
            }}
          />

          {/* §02 functional descriptor */}
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.5,
              color: 'var(--text-primary)',
              maxWidth: 540,
              margin: '0 0 12px',
              fontWeight: 500,
            }}
          >
            Free, nonpartisan legislative intelligence for Washington State.
          </p>

          {/* §14 voice — single supporting line, no overclaim */}
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-mid)', maxWidth: 560, margin: 0 }}>
            Trajectory scores, momentum, and committee activity for every bill in Olympia. Built
            for advocates, staff, journalists, and anyone who wants to read the building.
          </p>

          {/* Thread 9 — discoverable explainer link for first-time visitors */}
          <Link
            href="/how-it-works"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 14,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.01em',
              color: 'var(--teal)',
              textDecoration: 'none',
              borderBottom: '1px solid rgba(184,151,90,0.4)',
              paddingBottom: 1,
            }}
          >
            How Vector works <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      {/* ── ENTRY TILES ──────────────────────────────────────────────── */}
      <section
        style={{
          padding: '8px 16px 28px',
          maxWidth: 720,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <EntryTile
            href="/search"
            title="Search bills"
            body="Filter by category, sponsor, committee, or status."
          />
          <EntryTile
            href="/committees"
            title="Browse committees"
            body="See where each bill is sitting and what's queued for hearings."
          />
          <EntryTile
            href="/members"
            title="Browse legislators"
            body="Senators, representatives, sponsorship and committee assignments."
          />
        </div>
      </section>

      {/* ── BILLS-MOVING WIDGET ──────────────────────────────────────── */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '8px 0 24px' }}>
        <BillsMovingWidget />
      </section>

      {/* Footer (with §02 ownership line) is rendered globally by layout.tsx */}
    </div>
  )
}

function EntryTile({ href, title, body }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '16px 16px 18px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        textDecoration: 'none',
        transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--teal)'
        e.currentTarget.style.background = 'var(--bg-card-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-card)'
      }}
    >
      <div
        style={{
          fontSize: 15,
          color: 'var(--text-primary)',
          fontWeight: 600,
          letterSpacing: '0.01em',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{body}</div>
    </Link>
  )
}
