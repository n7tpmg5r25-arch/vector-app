'use client'
// Methodology -- condensed to a short, plain breakdown (2026-06-20). The dense
// calibration table (Wilson CIs, live per-biennium query) and exact per-signal
// weights were removed in favor of a quick, honest explainer. Plain-English
// summaries are AI-generated; the trajectory score is a calibrated signal model.
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import { useViewer } from '../../lib/viewer-capabilities'

const SIGNALS = [
  { name: 'Committee', d: "Hearings, executive sessions, and votes -- a bill that gets a hearing is in a different world from one that doesn't." },
  { name: 'Sponsor', d: "Majority-party sponsors, committee chairs, and bipartisan rosters all signal support." },
  { name: 'Momentum', d: "Moving recently, or stalled?" },
  { name: 'History', d: "How bills in the same category have fared in past sessions." },
  { name: 'Fiscal', d: "No-cost bills move faster than ones that need funding." },
]

const TIERS = [
  { l: 'HIGH', r: '75-99', c: 'var(--sage)' },
  { l: 'Moderate', r: '60-74', c: 'var(--deep-teal)' },
  { l: 'Low', r: '45-59', c: 'var(--amber)' },
  { l: 'Very Low', r: '0-44', c: 'var(--stone)' },
]

const SECTION_LABEL = {
  fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em',
  textTransform: 'uppercase', marginBottom: 10, fontWeight: 600,
  borderLeft: '2px solid var(--brass)', paddingLeft: 10,
}
const CARD = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', padding: '16px',
  fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65,
}

export default function MethodologyPage() {
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {isAnonPublic && <PublicNav />}

      {/* STICKY HEADER */}
      <div style={{
        position: !isAnonPublic ? 'sticky' : 'static',
        top: 0, zIndex: 50,
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 20px 20px' : '52px 20px 20px',
      }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>Methodology</h1>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>How Vector | WA scores bills</div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* INTRO */}
        <div style={CARD}>
          Vector reads <strong style={{ color: 'var(--text-primary)' }}>every bill</strong> in the Washington
          State Legislature and gives each one a <strong style={{ color: 'var(--text-primary)' }}>0&ndash;99 trajectory
          score</strong> &mdash; a quick read on how likely it is to keep advancing. Plain-English summaries are
          AI-generated from the Legislature&apos;s official record and refreshed through the day. The score is an
          estimate, not legal or political advice.
        </div>

        {/* HOW THE SCORE WORKS */}
        <div>
          <div style={SECTION_LABEL}>How the score works</div>
          <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              Five signals, weighted and combined, then adjusted by procedural <strong style={{ color: 'var(--text-primary)' }}>X-factors</strong>:
            </div>
            {SIGNALS.map((s, i) => (
              <div key={s.name} style={{ padding: '12px 16px', borderBottom: i < SIGNALS.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--teal)' }}>{s.name}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}> &mdash; {s.d}</span>
              </div>
            ))}
          </div>
          <div style={{ ...CARD, marginTop: 12 }}>
            X-factors nudge a score <span style={{ color: 'var(--sage)', fontWeight: 600 }}>up</span> (pulled from
            Rules, companion bill filed, strong floor margin) or <span style={{ color: 'var(--danger)', fontWeight: 600 }}>down</span>
            {' '}(held in Rules, cutoff pressure, stalled). One held-in-Rules event can drop a bill a full tier.
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {TIERS.map(t => (
                <span key={t.l} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: t.c, border: '1px solid ' + t.c, borderRadius: 999, padding: '3px 10px', letterSpacing: '0.04em' }}>
                  {t.l} {t.r}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* TRACK RECORD */}
        <div>
          <div style={SECTION_LABEL}>Track record</div>
          <div style={{ background: 'rgba(184,151,90,0.05)', border: '1px solid var(--brass)', borderRadius: 'var(--radius)', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 700, color: 'var(--sage)', lineHeight: 1 }}>~84%</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>of HIGH-tier bills (score 75+)<br />became law across past sessions</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>
              Most bills don&apos;t pass, so a high score means <strong style={{ color: 'var(--text-primary)' }}>on track</strong>, not guaranteed.
            </div>
          </div>
        </div>

        {/* LIMITS */}
        <div>
          <div style={SECTION_LABEL}>Limits</div>
          <div style={CARD}>
            It&apos;s a pattern-based estimate and can be wrong, and AI summaries can contain errors &mdash; verify
            anything important against the <strong style={{ color: 'var(--text-primary)' }}>official record</strong>, linked on
            every bill. The model doesn&apos;t use the governor&apos;s priorities, lobbying registrations, whip counts, or
            campaign finance. When the Legislature adjourns, each bill is marked Signed into Law, Passed Chamber, or
            Dead, and its score freezes until it is reintroduced.
          </div>
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <a href="/search" style={{ display: 'inline-block', padding: '12px 28px', background: 'var(--teal)', color: 'var(--bg)', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textDecoration: 'none', textTransform: 'uppercase' }}>Search Bills by Score &rarr;</a>
        </div>

      </div>

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}
