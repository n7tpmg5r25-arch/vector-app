'use client'
// Thread 72 — /roadmap (2026-05-09)
//
// Public-facing vertical timeline for Vector | WA shipped milestones
// (Sage checks) and coming milestones (Brass-light circles). A trust
// signal anchored to Brand v1.2 Truth #3 (transparent + accessible +
// public-data) and Truth #2 (probabilities not predictions — quarter-
// grain dates; only Aug 1 2027 carries a specific day because it is
// publicly committed).
//
// Shell mirrors /install (Thread 71 pattern):
//   PublicNav for anon visitors when public-layer flag is on,
//   owner Nav for authenticated users.
//   Sticky HEADER (PR #81 pattern) — sticky only when !isAnonPublic so
//   it doesn't stack with PublicNav's own fixed positioning.
//
// All milestone data derives from app/lib/roadmap.js — no inline date
// literals on this page.
//
// Mobile-only by design (480-px column). Vector | WA palette via CSS
// vars only. Three-voice typography:
//   Playfair Display — display headline + milestone titles
//   Karla           — body copy (fontFamily: var(--font-body))
//   DM Mono         — date chips (fontFamily: var(--font-mono))
//
// Three-tier impact: Public surface only. No role-gated content.
//
// Guardrails:
//   G1 — No hardcoded session labels, biennium literals.
//   G5 — No scoreBill / extractFeatures touches.
//   G6 — Page-scoped; PublicNav top-bar is shared, not globally mounted.

import Link from 'next/link'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import { useViewer } from '../../lib/viewer-capabilities'
import { SHIPPED, COMING } from '../../lib/roadmap'

// ─── Palette aliases (canonical → legacy var names) ─────────────────
const SAGE   = '#4a7c6f'  // functional shipped / success
const BRASS  = '#b8975a'  // var(--teal) legacy
const BRASS_LIGHT = '#d4b47a'  // var(--gold) legacy

// ─── Shared style constants ──────────────────────────────────────────
const EYEBROW = {
  fontFamily: 'var(--font-mono, "DM Mono", monospace)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-faint)',
  marginBottom: 12,
  fontWeight: 600,
}

const DATE_CHIP_BASE = {
  fontFamily: 'var(--font-mono, "DM Mono", monospace)',
  fontSize: 10,
  letterSpacing: '0.08em',
  fontWeight: 600,
  borderRadius: 4,
  padding: '2px 7px',
  display: 'inline-block',
  marginBottom: 6,
}

const MILESTONE_TITLE = {
  fontFamily: 'var(--font-display, "Playfair Display", serif)',
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text-primary)',
  lineHeight: 1.35,
  marginBottom: 5,
}

const MILESTONE_DESC = {
  fontSize: 13,
  color: 'var(--text-muted)',
  lineHeight: 1.6,
}

// ─── Timeline dot sizes ──────────────────────────────────────────────
const DOT_SIZE = 20   // px — outer diameter
const LINE_LEFT = 9   // px — left offset of the connector line (centres on dot)

// ─── MilestoneItem component ─────────────────────────────────────────
function MilestoneItem({ item, isLast }) {
  const isShipped = item.status === 'shipped'

  // Dot appearance
  const dotStyle = isShipped
    ? {
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: '50%',
        background: SAGE,
        boxShadow: '0 0 8px rgba(74,124,111,0.40)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 2,
      }
    : {
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: '50%',
        background: 'transparent',
        border: `2px solid ${BRASS_LIGHT}`,
        boxShadow: `0 0 8px rgba(212,180,122,0.25)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 2,
      }

  // Check SVG for shipped items
  const CheckIcon = () => (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <polyline
        points="2,6 5,9 10,3"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )

  // Date chip colours
  const chipStyle = isShipped
    ? {
        ...DATE_CHIP_BASE,
        background: 'rgba(74,124,111,0.15)',
        color: '#6dab9e',
        border: '1px solid rgba(74,124,111,0.30)',
      }
    : {
        ...DATE_CHIP_BASE,
        background: 'rgba(212,180,122,0.10)',
        color: BRASS_LIGHT,
        border: `1px solid rgba(212,180,122,0.25)`,
      }

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* Left column — dot + connector line */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        width: DOT_SIZE,
      }}>
        <div style={dotStyle}>
          {isShipped && <CheckIcon />}
        </div>
        {!isLast && (
          <div style={{
            flex: 1,
            width: 2,
            background: isShipped
              ? 'rgba(74,124,111,0.25)'
              : 'rgba(212,180,122,0.15)',
            marginTop: 4,
            borderRadius: 1,
            minHeight: 24,
          }} />
        )}
      </div>

      {/* Right column — content */}
      <div style={{ paddingBottom: isLast ? 0 : 24, flex: 1 }}>
        <div style={chipStyle}>{item.date}</div>
        <div style={MILESTONE_TITLE}>{item.title}</div>
        <div style={MILESTONE_DESC}>{item.description}</div>
      </div>
    </div>
  )
}

// ─── Section wrapper ─────────────────────────────────────────────────
function TimelineSection({ label, items }) {
  return (
    <section>
      <div style={EYEBROW}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((item, i) => (
          <MilestoneItem key={item.id} item={item} isLast={i === items.length - 1} />
        ))}
      </div>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────
export default function RoadmapPage() {
  // Mirrors the /install + /about + /methodology shell pattern:
  // viewerLoading destructured + isAnonPublic gated on !viewerLoading so
  // authed users don't flash PublicNav during the auth-resolve window.
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  const INLINE_LINK = {
    color: 'var(--teal)',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  }

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {isAnonPublic && <PublicNav />}

      {/* Sticky HEADER (PR #81 pattern). Sticky only when !isAnonPublic —
          PublicNav already pins for anon visitors; stacking two
          sticky-top-0 siblings conflicts. The 52px top padding clears the
          fixed HamburgerButton. */}
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
          fontFamily: 'var(--font-display, "Playfair Display", serif)',
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--teal)',
          textShadow: `0 0 16px rgba(184,151,90,0.2)`,
        }}>
          Roadmap
        </h1>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          What&apos;s shipped and what&apos;s next for Vector | WA.
        </div>
      </div>

      <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* SHIPPED */}
        <TimelineSection
          label={`${SHIPPED.length} shipped`}
          items={SHIPPED}
        />

        {/* Divider */}
        <div style={{
          borderTop: '1px solid var(--border)',
          marginTop: -12,
        }} />

        {/* COMING */}
        <TimelineSection
          label={`${COMING.length} coming`}
          items={COMING}
        />

        {/* TAIL — context card */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          fontSize: 13,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}>
          <div style={{
            marginBottom: 8,
            fontFamily: 'var(--font-mono, "DM Mono", monospace)',
            fontSize: 10,
            color: 'var(--text-faint)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>
            About these dates
          </div>
          Quarter-grain targets reflect the project&apos;s actual planning horizon,
          not marketing commitments. The one exception is the{' '}
          <strong style={{ color: 'var(--text-primary)' }}>August 1, 2027 public launch</strong>
          {' '}— a specific date that is publicly committed. For the scoring model and
          how trajectory estimates are built, see the{' '}
          <Link href="/methodology" style={INLINE_LINK}>methodology page</Link>
          .
        </div>

      </div>

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}
