'use client'
// Methodology page -- significantly condensed (OPEN-SOURCE thread, 2026-06-17).
// The live calibration data layer (Thread 67) is kept intact; the explanatory
// prose was cut by ~65% and the scoring engine is now noted as open source.
// Keeps: 84% TL;DR, the calibration table (combined-3B + the live per-biennium
// check), the five signals, the X-factor list, and a short scope/limits note.
import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import CohortCitation from '../components/CohortCitation'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, isInterimPeriod } from '../../lib/session-config'
import { fetchTotalScoredBills, joinBiennia, formatRecalculatedStamp } from '../../lib/app-stats'
import { useViewer } from '../../lib/viewer-capabilities'

const SIGNALS = [
  { name: 'Committee', range: '0–25', weight: 20, description: 'Public hearings, executive sessions, and committee votes. A bill that gets a hearing is fundamentally different from one sitting in the introduction pile.' },
  { name: 'Sponsor', range: '0–20', weight: 16, description: 'Who introduced it -- majority-party sponsors, committee chairs, bipartisan co-sponsorship, and broad rosters all signal support.' },
  { name: 'Momentum', range: '0–20', weight: 16, description: 'Activity level and recency. Stalled bills are penalized; recent status changes carry more weight than old introductions.' },
  { name: 'Historical', range: '0–20', weight: 16, description: 'Category-level pass rates calibrated from thousands of bills across multiple biennia. Tax bills behave differently than transportation bills.' },
  { name: 'Fiscal', range: '0–15', weight: 12, description: 'Fiscal note size. Bills with no fiscal impact move faster than ones that need funding.' },
]

const XF_POS = [
  { l: 'Pulled from Rules', d: '+15%' },
  { l: 'Companion bill filed', d: '+10%' },
  { l: '2nd chamber reached', d: '+8%' },
  { l: 'Strong floor margin (≥75%)', d: '+8%' },
  { l: 'Exec session passed', d: '+6%' },
  { l: 'Substitute filed', d: '+5%' },
]
const XF_NEG = [
  { l: 'Held in Rules', d: '−20%' },
  { l: 'Cutoff pressure (≤5 days)', d: '−18%' },
  { l: 'Stalled (>28 days)', d: '−10%' },
  { l: 'Minority-only sponsorship', d: '−10%' },
  { l: 'Double referral', d: '−8%' },
  { l: 'Fiscal referral', d: '−6%' },
  { l: 'Narrow margin (<60%)', d: '−6%' },
  { l: 'High amendment count (>3)', d: '−5%' },
]

const COMBINED_3B = [
  { bucket: '75–99', label: 'HIGH',     rate: '84.0%', ci: '82.5 – 85.4%' },
  { bucket: '60–74', label: 'MODERATE', rate: '1.8%',  ci: '1.2 – 2.8%'   },
  { bucket: '45–59', label: 'LOW',      rate: '0.0%',  ci: '0.0 – 0.5%'   },
  { bucket: '0–44',  label: 'VERY LOW', rate: '0.0%',  ci: '0.0 – 0.1%'   },
]

const TIER_COLOR = {
  'HIGH':     'var(--sage)',
  'MODERATE': 'var(--deep-teal)',
  'LOW':      'var(--amber)',
  'VERY LOW': 'var(--stone)',
}

const SECTION_LABEL = {
  fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em',
  textTransform: 'uppercase', marginBottom: 10, fontWeight: 600,
  borderLeft: '2px solid var(--brass)', paddingLeft: 10,
}

const CARD = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', padding: '16px',
}

export default function MethodologyPage() {
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  const [calibration, setCalibration]     = useState(null)
  const [sourceSession, setSourceSession] = useState(null)
  const [totalN, setTotalN]               = useState(null)

  const [cohortTotal,     setCohortTotal]     = useState(8062)
  const [cohortBiennia,   setCohortBiennia]   = useState(['2021-2022', '2023-2024', '2025-2026'])
  const [cohortStampedAt, setCohortStampedAt] = useState(null)

  useEffect(() => {
    const sb = createBrowserClient()

    fetchTotalScoredBills(sb).then((stats) => {
      if (stats && stats.ok && stats.total > 0 && stats.biennia.length > 0) {
        setCohortTotal(stats.total)
        setCohortBiennia(stats.biennia)
        setCohortStampedAt(stats.computedAt)
      }
    }).catch(() => { /* keep fallback */ })

    let calSession = getCurrentSession()
    if (!isInterimPeriod()) {
      const [startY] = calSession.split('-')
      const prev = parseInt(startY, 10) - 2
      calSession = `${prev}-${prev + 1}`
    }

    const BUCKET_DISPLAY = { HIGH: '75–99', MODERATE: '60–74', LOW: '45–59', 'VERY LOW': '0–44' }
    sb.from('v_calibration_buckets_by_session')
      .select('label, bills, chamber_count, law_count')
      .eq('session', calSession)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setCalibration([]); setSourceSession(calSession); return
        }
        const byLabel = {}
        let totalBills = 0
        for (const row of data) { byLabel[row.label] = row; totalBills += row.bills || 0 }
        if (totalBills < 100) {
          setCalibration([]); setSourceSession(calSession); return
        }
        const rows = ['HIGH', 'MODERATE', 'LOW', 'VERY LOW'].map(k => {
          const v = byLabel[k] || { bills: 0, chamber_count: 0, law_count: 0 }
          return {
            bucket: BUCKET_DISPLAY[k], label: k, bills: v.bills || 0,
            chamber: v.bills > 0 ? (v.chamber_count / v.bills) * 100 : 0,
            law:     v.bills > 0 ? (v.law_count     / v.bills) * 100 : 0,
          }
        })
        setCalibration(rows); setSourceSession(calSession); setTotalN(totalBills)
      })
  }, [])

  const sessionShort = sourceSession
    ? sourceSession.split('-').map((y, i) => i === 1 ? y.slice(2) : y).join('-')
    : '…'
  const calibrationLoading = calibration === null
  const calibrationEmpty   = Array.isArray(calibration) && calibration.length === 0

  const cohortTotalStr   = cohortTotal.toLocaleString()
  const cohortBienniaStr = joinBiennia(cohortBiennia)
  const cohortCountStr   = cohortBiennia.length.toString()
  const cohortStamp      = cohortStampedAt ? formatRecalculatedStamp(cohortStampedAt) : null

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
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>Methodology</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>How Vector | WA scores bills</div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* COVERAGE + OPEN SOURCE */}
        <div style={{ ...CARD, padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            Coverage &amp; freshness
          </div>
          Vector | WA tracks <strong style={{ color: 'var(--text-primary)' }}>every bill</strong> in the
          Washington State Legislature each biennium &mdash; not a sample &mdash; syncing status, votes,
          committee actions, and sponsors from the Legislature&apos;s official record through the day. The
          scoring engine is <strong style={{ color: 'var(--text-primary)' }}>open source</strong>; the latest
          sync time shows in the footer of every page.
        </div>

        {/* TL;DR -- 84% */}
        <div style={{ background: 'rgba(184,151,90,0.05)', border: '1px solid var(--brass)', borderRadius: 'var(--radius)', padding: '16px' }}>
          <div style={{ fontSize: 10, color: 'var(--brass)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>TL;DR</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: TIER_COLOR.HIGH, lineHeight: 1 }}>84%</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>of HIGH-tier bills (score 75+)<br />became law &mdash; across 8,062 bills</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            Vector scores every bill 0&ndash;99 from five weighted signals &times; an X-Factor multiplier,
            calibrated against actual outcomes from <CohortCitation variant="bills-first" />. Recalibrated nightly.
          </div>
          {cohortStamp && (<div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>Recalculated: {cohortStamp}.</div>)}
        </div>

        {/* CALIBRATION TABLE */}
        <div>
          <div style={SECTION_LABEL}>Calibration</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              The engine is calibrated against all {cohortCountStr} biennia combined &mdash; {cohortTotalStr} bills
              spanning {cohortBienniaStr}. These are the exact pass rates every score on this site resolves to,
              with 95% Wilson confidence intervals.
            </div>
            {COMBINED_3B.map((c) => (
              <div key={c.bucket} style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{c.bucket}</span>
                  <span style={{ fontSize: 12, color: TIER_COLOR[c.label], fontWeight: 700, letterSpacing: '0.06em' }}>{c.label}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-muted)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: TIER_COLOR[c.label], fontWeight: 700 }}>{c.rate}</span>{' '}
                  <span style={{ color: TIER_COLOR[c.label], fontWeight: 600 }}>became law</span>
                  <span style={{ color: 'var(--brass)', margin: '0 4px' }}>&middot;</span>
                  95% CI <span style={{ fontFamily: 'var(--font-mono)' }}>{c.ci}</span>
                </div>
              </div>
            ))}
            <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', lineHeight: 1.6, background: 'rgba(184,151,90,0.04)' }}>
              This is not a prediction for one specific bill &mdash; it is the historical pass rate of bills
              that looked like it. A bill scoring 80 sits in a bucket where 84% of its peers became law once
              the session ended; if its situation changes, the score updates at the next sync.
            </div>

            {/* live per-biennium check (data layer preserved) */}
            <div style={{ borderTop: '2px solid var(--border)' }}>
              <div style={{ padding: '12px 16px 4px', fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                Most recent biennium check ({sessionShort})
              </div>
              {calibrationLoading && (
                <div style={{ padding: '16px', fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', textAlign: 'center' }}>Loading…</div>
              )}
              {calibrationEmpty && (
                <div style={{ padding: '4px 16px 14px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  Live check temporarily unavailable. The combined three-biennium calibration above remains
                  what every score resolves to. Refresh to retry.
                </div>
              )}
              {!calibrationLoading && !calibrationEmpty && (
                <div>
                  {calibration.map((c) => (
                    <div key={c.bucket} style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{c.bucket}</span>
                        <span style={{ fontSize: 11, color: TIER_COLOR[c.label], fontWeight: 700, letterSpacing: '0.06em' }}>{c.label}</span>
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-muted)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{c.bills.toLocaleString()}</span> bills
                        <span style={{ color: 'var(--brass)', margin: '0 4px' }}>&middot;</span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{c.chamber.toFixed(1)}%</span> reached chamber
                        <span style={{ color: 'var(--brass)', margin: '0 4px' }}>&middot;</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: TIER_COLOR[c.label], fontWeight: 700 }}>{c.law.toFixed(1)}%</span>{' '}
                        <span style={{ color: TIER_COLOR[c.label], fontWeight: 600 }}>became law</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
                    Source: Vector | WA, full {sourceSession} biennium. N={totalN?.toLocaleString()}. Recalculated on every page load.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* THE FIVE SIGNALS */}
        <div>
          <div style={SECTION_LABEL}>The Five Signals</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {SIGNALS.map((s, i) => {
              const desc = s.name === 'Historical'
                ? `Category-level pass rates calibrated from ${cohortTotalStr} bills across ${cohortCountStr} biennia (${cohortBienniaStr}). Tax bills behave differently than transportation bills.`
                : s.description
              return (
                <div key={s.name} style={{ padding: '14px 16px', borderBottom: i < SIGNALS.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--teal)' }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{s.range} pts &middot; {s.weight}% weight</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{desc}</div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.55 }}>
            A stage-advancement bonus (0&ndash;25 pts) stacks on top for bills that have cleared cutoffs. Raw
            totals map to the displayed 0&ndash;99 score via a fixed transform; tier lines sit at 75 / 60 / 45.
          </div>
        </div>

        {/* X FACTORS */}
        <div>
          <div style={SECTION_LABEL}>X Factors</div>
          <div style={{ ...CARD, padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
              Procedural signals a seasoned analyst watches, combined into one multiplier on the base score:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>clamp(1 + &Sigma;pos &minus; &Sigma;neg, 0.5&times;, 1.5&times;)</span>.
              One Held-in-Rules event can drop a bill a full tier in a single sync.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>POSITIVE</div>
                {XF_POS.map(x => (
                  <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
                    <span>{x.l}</span>
                    <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-mono)', marginLeft: 12, flexShrink: 0 }}>{x.d}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>NEGATIVE</div>
                {XF_NEG.map(x => (
                  <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
                    <span>{x.l}</span>
                    <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', marginLeft: 12, flexShrink: 0 }}>{x.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* SCOPE & LIMITS (condensed political dynamics + interim) */}
        <div>
          <div style={SECTION_LABEL}>Scope &amp; limits</div>
          <div style={{ ...CARD, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
            Vector also computes four political-dynamics signals &mdash; bipartisan index, cross-aisle count,
            chair alignment, and sponsor track record &mdash; shown on bills and members but{' '}
            <strong style={{ color: 'var(--text-primary)' }}>not</strong> folded into the trajectory score.
            The model does not use the governor&apos;s stated priorities, lobbying registrations, whip counts,
            or campaign finance &mdash; those are not reliably structured in public data.
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              When the Legislature adjourns, each bill is marked{' '}
              <span style={{ color: 'var(--sage)', fontWeight: 600 }}>Signed into Law</span>,{' '}
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Passed Chamber</span>, or{' '}
              <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Dead</span>, and trajectory scores
              freeze at where the bill stood at session end. A bill reintroduced next session gets a fresh score.
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <a href="/search" style={{ display: 'inline-block', padding: '12px 28px', background: 'var(--teal)', color: 'var(--bg)', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textDecoration: 'none', textTransform: 'uppercase' }}>Search Bills by Score &rarr;</a>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>See the scoring model in action on live legislation</div>
        </div>

      </div>

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}
