'use client'
// Phase 6 Thread 60 -- /changelog Public Transparency Surface (2026-05-02)
//
// Renders the CHANGELOG array from app/lib/changelog.js as a newest-first
// list. This is a transparency-only surface; anon viewers are admitted via
// the proxy.js public-layer allowlist (Thread 60 update). Drawer version
// pill from Thread 59 / 60 links here.
//
// Mirrors the /about page shell pattern (Thread 24): `'use client'` because
// the Nav vs PublicNav branch depends on useViewer(), which is a client hook.
// The CHANGELOG data itself is a static module-level export, so there is no
// server-side data fetching to recoup by switching to a Server Component.
//
// Per CLAUDE.md three-tier rule: routes (`/c/[slug]/*`), DB schema, and
// internal role symbols (`'owner'`, `'client'`) intentionally retained.
// User-visible vocabulary uses Public / Registered / Team copy; this page
// is anon-public so it never surfaces those labels.
//
// Mobile-only by design (480-px column). Vector | WA palette via CSS vars
// only -- no Shorepine firm Forest/Parchment.
//
// Type system per Brand Guide v1.2 §02:
//   - var(--font-display) Playfair Display -> version label (display heading)
//   - var(--font-mono)    DM Mono           -> date + phase pill (metadata)
//   - var(--font-body)    Karla             -> highlight bullets (body)
//
// Guardrails:
//   G1 -- No hardcoded session labels or biennium literals. Entry dates are
//         absolute ISO yyyy-mm-dd; the version helper handles phase rollover.
//   G5 -- No scoreBill / extractFeatures touches.
//   G6 -- Page-scoped surface; PublicNav top-bar shared across public routes
//         is unchanged structurally. SideDrawer (globally mounted) carries
//         the version pill that points here.
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import { useViewer } from '../../lib/viewer-capabilities'
import { CHANGELOG } from '../../lib/changelog'

const CARD = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: 16,
  fontSize: 14,
  color: 'var(--text-muted)',
  lineHeight: 1.65,
}

const VERSION_LABEL = {
  fontFamily: 'var(--font-display)',
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--text-primary)',
  letterSpacing: '0.01em',
  lineHeight: 1.15,
}

const META_ROW = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 6,
}

const DATE_TEXT = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  color: 'var(--text-faint)',
  textTransform: 'uppercase',
}

const PHASE_PILL = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--brass-light, var(--gold))',
  background: 'rgba(184,151,90,0.10)',
  border: '1px solid rgba(184,151,90,0.30)',
  borderRadius: 999,
  fontWeight: 600,
}

const BULLET_LIST = {
  margin: '14px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const BULLET = {
  position: 'relative',
  paddingLeft: 16,
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  color: 'var(--text-muted)',
  lineHeight: 1.6,
}

// Inline left-edge dot. Brass at 60% opacity matches the calibration card
// dot pattern used elsewhere; works against bg-card without competing with
// the phase pill above.
const BULLET_DOT = {
  position: 'absolute',
  left: 0,
  top: '0.65em',
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'rgba(184,151,90,0.6)',
}

function formatDate(iso) {
  // Render as 'May 1, 2026' for readability while keeping the source as
  // ISO. Uses local time -- the date component of an ISO yyyy-mm-dd string
  // is timezone-stable for our purposes (no time component supplied).
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ChangelogPage() {
  // Mirror /about: viewerLoading destructured + isAnonPublic gated on
  // !viewerLoading so authed users don't flash PublicNav during auth resolve
  // (Thread 15.2 pattern, reused throughout the public-layer surfaces).
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {isAnonPublic && <PublicNav />}

      {/* Locked HEADER -- mirrors the /about pattern (PR #81).
          Sticky only when !isAnonPublic; for anon viewers PublicNav is
          already sticky at top:0 above this. The 52px top padding clears
          the fixed-position HamburgerButton for authed viewers. */}
      <div style={{
        position: !isAnonPublic ? 'sticky' : 'static',
        top: 0, zIndex: 50,
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 20px 20px' : '52px 20px 20px',
      }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>Changelog</h1>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          What shipped, when. Newest first.
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {CHANGELOG.length === 0 ? (
          <div style={CARD}>
            <p style={{ margin: 0 }}>
              Nothing here yet &mdash; check back after the next ship.
            </p>
          </div>
        ) : (
          CHANGELOG.map((entry) => (
            <article
              key={`${entry.version}-${entry.date}`}
              style={CARD}
              aria-labelledby={`vec-changelog-${entry.version}`}
            >
              <div
                id={`vec-changelog-${entry.version}`}
                style={VERSION_LABEL}
              >
                {entry.version}
              </div>
              <div style={META_ROW}>
                <span style={DATE_TEXT}>{formatDate(entry.date)}</span>
                <span style={PHASE_PILL}>{entry.phase}</span>
              </div>
              <ul style={BULLET_LIST}>
                {entry.highlights.map((line, i) => (
                  <li key={i} style={BULLET}>
                    <span style={BULLET_DOT} aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}

        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          fontSize: 13,
          color: 'var(--text-muted)',
          lineHeight: 1.55,
        }}>
          <div style={{
            marginBottom: 8,
            fontSize: 11,
            color: 'var(--text-faint)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>
            Go deeper
          </div>
          <div>
            For the scoring formula and live calibration table, see the{' '}
            <a href="/methodology" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
              methodology page
            </a>
            . For data sources, model uncertainty, and corrections, see the{' '}
            <a href="/disclaimers" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
              disclaimers page
            </a>
            .
          </div>
        </div>

      </div>

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}
