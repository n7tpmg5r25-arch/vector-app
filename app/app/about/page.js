'use client'
// Thread 24 -- /about Public About Page (2026-04-26)
// Short About surface explaining the project + free-launch timeline.
// Mirrors the /how-it-works shell pattern (PublicNav for anon when the
// public-layer flag is on, owner Nav for authed viewers).
//
// Per directive D1 (CLAUDE.md, 2026-04-26): the public-facing site must NOT
// mention Shorepine Government Relations in any visible copy. This page is
// public-layer only; it credits Vector | WA as the project name and frames
// the launch timeline without naming the parent firm. The Footer's
// viewer-branched bottom line still attributes Shorepine for owner viewers,
// per Thread 19.1 -- that branching is unchanged here.
//
// Mobile-only by design (480-px column). Vector | WA palette via CSS vars
// only -- no Shorepine firm Forest/Parchment.
//
// Guardrails:
//   G1 -- No hardcoded session labels or biennium literals. The launch
//         framing ("mid 2027") is a target date, not a session-bound string.
//   G5 -- No scoreBill / extractFeatures touches; no cohort literal touches.
//   G6 -- Page-scoped surface; PublicNav top-bar shared across public routes
//         is unchanged structurally.
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import { useViewer } from '../../lib/viewer-capabilities'

const CARD = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: 16,
  fontSize: 14,
  color: 'var(--text-muted)',
  lineHeight: 1.65,
}

const EYEBROW = {
  fontSize: 10,
  color: 'var(--text-faint)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: 10,
  fontWeight: 600,
}

const HIGHLIGHT = { color: 'var(--teal)', fontWeight: 600 }

export default function AboutPage() {
  // Mirrors the how-it-works shell -- viewerLoading destructured + isAnonPublic
  // gated on !viewerLoading so authed users don't flash PublicNav during
  // auth resolve (Thread 15.2 pattern).
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {isAnonPublic && <PublicNav />}

      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 20px 20px' : '52px 20px 20px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>About Vector | WA</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          What this site is, who it&apos;s for, and when it launches.
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div>
          <div style={EYEBROW}>1 &middot; What Vector | WA is</div>
          <div style={CARD}>
            <p style={{ marginTop: 0 }}>
              Vector | WA is a Washington State legislative intelligence tool. It watches every
              bill introduced in the WA Legislature, scores its trajectory from{' '}
              <span style={HIGHLIGHT}>0 to 99</span>, and refreshes nightly. The score blends five
              procedural signals &mdash; committee placement, sponsor profile, momentum, historical
              category pass rates, and fiscal note size &mdash; calibrated against thousands of
              past bills with known outcomes.
            </p>
            <p style={{ marginBottom: 0 }}>
              The site is built for anyone who works with Washington State legislation: legislative
              staff, advocates, registered lobbyists, journalists, researchers, students, and the
              general public. It&apos;s not a registered lobbying entity, doesn&apos;t represent
              clients before the Legislature, and doesn&apos;t take partisan positions. The only
              job is to make the public record easier to read.
            </p>
          </div>
        </div>

        <div>
          <div style={EYEBROW}>2 &middot; Why it&apos;s free</div>
          <div style={CARD}>
            <p style={{ marginTop: 0 }}>
              Most legislative trackers cost money. Vector | WA is free because the underlying
              data &mdash; bill text, sponsor rosters, committee actions, votes, fiscal notes
              &mdash; is already public. The Washington State Legislature publishes it; this site
              just makes it scannable.
            </p>
            <p style={{ marginBottom: 0 }}>
              There are no ads, no upsells, and no tracking pixels selling your reading habits to a
              third party. The site runs on a small budget and is designed to stay that way. If
              the score is useful to you, the best thanks is to{' '}
              <a href="/disclaimers" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
                read the disclaimers
              </a>
              {' '}and report any errors via the corrections email there.
            </p>
          </div>
        </div>

        <div>
          <div style={EYEBROW}>3 &middot; Launch timeline</div>
          <div style={CARD}>
            <p style={{ marginTop: 0 }}>
              The public site is targeting a <span style={HIGHLIGHT}>mid 2027</span> launch &mdash;
              in time for the 2027 legislative session. Until then, you&apos;re looking at a
              working preview: every bill is here, every committee is here, every legislator is
              here, and the trajectory engine is calibrated and live. Some surfaces are still
              being polished, and a few features (saved watchlists, alert emails, PDF export)
              require a sign-in that isn&apos;t open to the public yet.
            </p>
            <p style={{ marginBottom: 0 }}>
              You can browse anonymously today. Bookmark the site and check back &mdash; the
              calibration tables on the{' '}
              <a href="/methodology" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
                methodology page
              </a>
              {' '}refresh each session, and the{' '}
              <a href="/how-it-works" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
                how-it-works
              </a>
              {' '}explainer covers the score in plain English.
            </p>
          </div>
        </div>

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
            For the full scoring formula and live calibration table, see the{' '}
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