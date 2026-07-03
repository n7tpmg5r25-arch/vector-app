'use client'

import { useEffect } from 'react'

// AUDIT-1 (2026-07-02): branded route-error boundary. Catches render and
// data errors below the root layout and offers a retry instead of the
// framework's unstyled dead end. Error internals go to the console only;
// the user sees plain-language copy per Brand Guide v1.2 section 05.
export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('[route-error]', error)
  }, [error])

  return (
    <div style={{
      minHeight: '70vh', maxWidth: 480, margin: '0 auto',
      padding: '64px 24px 48px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 14,
    }}>
      <img
        src="/logos/vector-wa-primary.svg"
        alt="Vector | WA"
        style={{ height: 56, filter: 'drop-shadow(0 0 18px rgba(184,151,90,0.25))' }}
      />
      <div style={{
        fontFamily: 'var(--font-dm-mono, monospace)', fontSize: 11,
        letterSpacing: '0.14em', color: '#6c7078', marginTop: 18,
      }}>
        SOMETHING WENT WRONG
      </div>
      <h1 style={{
        fontFamily: 'var(--font-playfair, Georgia, serif)', fontSize: 26,
        fontWeight: 600, color: '#e8e9ec', margin: 0,
      }}>
        This page hit an error
      </h1>
      <p style={{
        fontFamily: 'var(--font-karla, sans-serif)', fontSize: 14.5,
        color: '#a8acb4', margin: 0, lineHeight: 1.6,
      }}>
        It is usually temporary. Try again, or head back to the dashboard.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => reset()} style={{
          padding: '10px 22px', borderRadius: 8, background: '#b8975a',
          color: '#0e1014', fontFamily: 'var(--font-karla, sans-serif)',
          fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
        }}>
          Try again
        </button>
        <a href="/" style={{
          padding: '10px 22px', borderRadius: 8, border: '1px solid #2a2d38',
          color: '#d4b47a', fontFamily: 'var(--font-karla, sans-serif)',
          fontSize: 14, fontWeight: 600, textDecoration: 'none',
        }}>
          Go to home
        </a>
      </div>
    </div>
  )
}
