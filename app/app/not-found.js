import Link from 'next/link'

// AUDIT-1 (2026-07-02): branded 404. Before this, unmatched routes rendered
// Next.js's unstyled default with no logo and no way back into the app.
// Server component, no data fetch -- safe on every viewer layer. Pre-launch,
// anon visitors rarely reach it (the proxy redirects unknown non-dotted
// paths to /login); signed-in users and dotted paths land here.
export default function NotFound() {
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
        404 &middot; PAGE NOT FOUND
      </div>
      <h1 style={{
        fontFamily: 'var(--font-playfair, Georgia, serif)', fontSize: 26,
        fontWeight: 600, color: '#e8e9ec', margin: 0,
      }}>
        That page does not exist
      </h1>
      <p style={{
        fontFamily: 'var(--font-karla, sans-serif)', fontSize: 14.5,
        color: '#a8acb4', margin: 0, lineHeight: 1.6,
      }}>
        The link may be outdated, or the address was mistyped.
        Bill and member pages can move between sessions.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/" style={{
          padding: '10px 22px', borderRadius: 8, background: '#b8975a',
          color: '#0e1014', fontFamily: 'var(--font-karla, sans-serif)',
          fontSize: 14, fontWeight: 600, textDecoration: 'none',
        }}>
          Go to home
        </Link>
        <Link href="/search" style={{
          padding: '10px 22px', borderRadius: 8, border: '1px solid #2a2d38',
          color: '#d4b47a', fontFamily: 'var(--font-karla, sans-serif)',
          fontSize: 14, fontWeight: 600, textDecoration: 'none',
        }}>
          Search bills
        </Link>
      </div>
    </div>
  )
}
