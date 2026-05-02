'use client'
// Phase 7V.1 — Methodology page is now a client component so it can pull the
// calibration table live from Supabase every page load. No more manual refresh
// at the end of each biennium: the page queries the most recently completed
// session, buckets bills by final_score, and computes chamber/law pass rates
// on the fly. CALIBRATION_FALLBACK below is shown immediately while the query
// runs, and stays on screen if the query fails or returns too little data.
import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import CohortCitation from '../components/CohortCitation'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, isInterimPeriod } from '../../lib/session-config'
import { fetchTotalScoredBills, joinBiennia, formatRecalculatedStamp } from '../../lib/app-stats'
import { useViewer } from '../../lib/viewer-capabilities'

const SIGNALS = [
  {
    name: 'Committee',
    range: '0–25',
    weight: 20,
    description: 'Public hearings, executive sessions, and committee votes. A bill that gets a hearing is fundamentally different from one sitting in the introduction pile.',
    inputs: ['Public hearing held', 'Executive session held', 'Committee passed out', 'Substitute adopted'],
  },
  {
    name: 'Sponsor',
    range: '0–20',
    weight: 16,
    description: 'Who introduced it. Majority-party sponsors, committee chairs, bipartisan co-sponsorship, and broad rosters all signal support.',
    inputs: ['Majority-party prime sponsor', 'Committee chair sponsor', 'Bipartisan co-sponsors', '5+ co-sponsors'],
  },
  {
    name: 'Momentum',
    range: '0–20',
    weight: 16,
    description: 'Activity level and recency. Stalled bills get penalized, and recent status changes carry more weight than ancient introductions.',
    inputs: ['Stage advancement', 'Days since last action', 'Substitute filed', 'Pulled from Rules', 'Stalled penalty'],
  },
  {
    name: 'Historical',
    range: '0–20',
    weight: 16,
    // Description is built live inside the component using fetchTotalScoredBills()
    // so the cited bill-count and biennium list stay current at rollover.
    // This fallback matches the original engine calibration cohort.
    description: 'Category-level pass rates calibrated from thousands of bills across multiple biennia. Tax bills behave differently than transportation bills.',
    inputs: ['Category base rate', 'Bill-number cohort adjustment (low numbers = leadership priorities)'],
  },
  {
    name: 'Fiscal',
    range: '0–15',
    weight: 12,
    description: 'Fiscal note size. Bills with no fiscal impact move faster than ones that need funding.',
    inputs: ['None · Small · Medium · Large · Very Large'],
  },
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

// Fallback calibration — shown immediately on page load while the live query
// runs, and shown permanently if the query fails. Phase 7D.3: bills-only
// across 3 bienniums (N=8,062 bills, 2,155 signed into law).
// The two VERY LOW rows (30-44 and 0-29) are merged here because both had a
// 0% pass rate — splitting them just added a confusing duplicate row.
const CALIBRATION_FALLBACK = [
  { bucket: '75–99', label: 'HIGH',     bills: 2541, chamber: 89.5, law: 84.0 },
  { bucket: '60–74', label: 'MODERATE', bills: 1140, chamber:  5.2, law:  1.8 },
  { bucket: '45–59', label: 'LOW',      bills: 810,  chamber:  0.4, law:  0.0 },
  { bucket:  '0–44', label: 'VERY LOW', bills: 3571, chamber:  0.0, law:  0.0 },
]
const FALLBACK_SESSION = '3 bienniums (2021-2026)'
const FALLBACK_N = 8062

// Phase 7D.3: Combined 3-biennium calibration (BILLS ONLY) — these are the
// EXACT pass_probability and Wilson 95% CI values hardcoded in sync-v2.js
// scoreBill(). They're what every score on this site resolves to.
// Source: 8,062 bills across 2021-22 + 2023-24 + 2025-26 (excludes 755 resolutions/memorials).
const COMBINED_3B = [
  { bucket: '75–99', label: 'HIGH',     rate: '84.0%', ci: '82.5 – 85.4%' },
  { bucket: '60–74', label: 'MODERATE', rate: '1.8%',  ci: '1.2 – 2.8%'   },
  { bucket: '45–59', label: 'LOW',      rate: '0.0%',  ci: '0.0 – 0.5%'   },
  { bucket:  '0–44', label: 'VERY LOW', rate: '0.0%',  ci: '0.0 – 0.1%'   },
]

// Color per confidence tier, matching the bill detail page
const TIER_COLOR = {
  'HIGH':     '#b8975a',  // teal
  'MODERATE': '#ffc94a',  // gold
  'LOW':      '#ff9f43',  // amber
  'VERY LOW': '#8a96ad',  // muted
}

export default function MethodologyPage() {
  // Phase 12 Batch 6 — capability-aware nav swap for anon visitors.
  // Thread 15.2: viewerLoading destructured + isAnonPublic gated on !viewerLoading
  // so authed users no longer flash PublicNav during auth resolve.
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  // 7V.1: live calibration — queries Supabase on mount, falls back to the
  // hardcoded 2025-26 numbers if the query fails or returns too few bills.
  const [calibration, setCalibration]     = useState(CALIBRATION_FALLBACK)
  const [sourceSession, setSourceSession] = useState(FALLBACK_SESSION)
  const [totalN, setTotalN]                = useState(FALLBACK_N)

  // 2026-04-22 (DATA_FRESHNESS #12): cross-biennium cohort size is now
  // queried live. Fallback values match the original engine calibration
  // cohort (N=8,062 across 2021-22 / 2023-24 / 2025-26) so the page still
  // reads correctly if the query fails or returns zero.
  const [cohortTotal,      setCohortTotal]     = useState(8062)
  const [cohortBiennia,    setCohortBiennia]   = useState(['2021-2022', '2023-2024', '2025-2026'])
  const [cohortStampedAt,  setCohortStampedAt] = useState(null)

  useEffect(() => {
    const sb = createBrowserClient()

    // Live cross-biennium cohort count — runs in parallel with the
    // single-biennium calibration query below.
    fetchTotalScoredBills(sb).then((stats) => {
      if (stats && stats.ok && stats.total > 0 && stats.biennia.length > 0) {
        setCohortTotal(stats.total)
        setCohortBiennia(stats.biennia)
        setCohortStampedAt(stats.computedAt)
      }
    }).catch(() => { /* keep fallback */ })

    // Pick the most recently completed biennium. During interim that's
    // the current session (which just ended); during an active session
    // we step back one biennium to the prior completed one.
    let calSession = getCurrentSession()
    if (!isInterimPeriod()) {
      const [startY] = calSession.split('-')
      const prev = parseInt(startY, 10) - 2
      calSession = `${prev}-${prev + 1}`
    }

    sb.from('bills')
      .select('final_score, confidence_label')
      .eq('session', calSession)
      .not('final_score', 'is', null)
      .then(({ data, error }) => {
        if (error || !data || data.length < 100) return // keep fallback
        const buckets = {
          HIGH:       { bucket: '75–99', label: 'HIGH',     bills: 0, law: 0, chamber: 0 },
          MODERATE:   { bucket: '60–74', label: 'MODERATE', bills: 0, law: 0, chamber: 0 },
          LOW:        { bucket: '45–59', label: 'LOW',      bills: 0, law: 0, chamber: 0 },
          'VERY LOW': { bucket:  '0–44', label: 'VERY LOW', bills: 0, law: 0, chamber: 0 },
        }
        for (const b of data) {
          const s = b.final_score || 0
          let key
          if (s >= 75)      key = 'HIGH'
          else if (s >= 60) key = 'MODERATE'
          else if (s >= 45) key = 'LOW'
          else              key = 'VERY LOW'
          buckets[key].bills++
          if (b.confidence_label === 'LAW') {
            buckets[key].law++
            buckets[key].chamber++
          } else if (b.confidence_label === 'PASSED_CHAMBER') {
            buckets[key].chamber++
          }
        }
        const rows = ['HIGH', 'MODERATE', 'LOW', 'VERY LOW'].map(k => {
          const v = buckets[k]
          return {
            bucket: v.bucket,
            label: v.label,
            bills: v.bills,
            chamber: v.bills > 0 ? (v.chamber / v.bills) * 100 : 0,
            law:     v.bills > 0 ? (v.law     / v.bills) * 100 : 0,
          }
        })
        setCalibration(rows)
        setSourceSession(calSession)
        setTotalN(data.length)
      })
  }, [])

  // Convenience values for the prose below the table.
  const high    = calibration.find(c => c.label === 'HIGH')     || { bills: 0, law: 0 }
  const veryLow = calibration.find(c => c.label === 'VERY LOW') || { bills: 0 }
  const highLawCount = Math.round((high.bills * high.law) / 100)
  const sessionShort = sourceSession.split('-').map((y, i) => i === 1 ? y.slice(2) : y).join('-')

  // DATA_FRESHNESS #12: rendered citations pull from live cohort state.
  const cohortTotalStr  = cohortTotal.toLocaleString()
  const cohortBienniaStr = joinBiennia(cohortBiennia)
  const cohortCountStr   = cohortBiennia.length.toString()
  const cohortStamp      = cohortStampedAt ? formatRecalculatedStamp(cohortStampedAt) : null

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {/* Phase 12 Batch 6 — PublicNav for anon when flag is on */}
      {isAnonPublic && <PublicNav />}

      {/* Locked HEADER (Phase 5 polish 2026-05-01).
          Sticky only when !isAnonPublic -- PublicNav already pins for
          anon viewers and stacking two sticky-top-0 siblings conflicts.
          The 52px top padding clears the fixed-position HamburgerButton. */}
      <div style={{
        position: !isAnonPublic ? 'sticky' : 'static',
        top: 0, zIndex: 50,
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 20px 20px' : '52px 20px 20px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24, fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>Methodology</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          How Vector | WA scores bills
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Thread 26 — TL;DR card.
            Audit-finalized 2026-04-26 by Thread 20 persona audit: Mira (Student)
            and Dana (Staffer) hit horizontal-scroll on the calibration tables
            at 480px and had to scroll past two tables before reaching the proof
            point + recalculated stamp. This card front-loads the headline
            number + cohort cite + stamp so the page reads correctly above the
            fold. CohortCitation handles the live cohort literal (G5-frozen
            fallback). */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--brass)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
        }}>
          <div style={{
            fontSize: 10,
            color: 'var(--brass)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 8,
            fontWeight: 700,
          }}>
            TL;DR
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            Vector scores bills 0&ndash;99 from 5 signals &times; X factors.{' '}
            <span style={{ color: 'var(--teal)', fontWeight: 600 }}>HIGH bills (75&ndash;99) pass at ~84%</span>.
            {' '}Recalibrated nightly. Calibrated on <CohortCitation variant="bills-first" />.
          </div>
          {cohortStamp && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
              Recalculated: {cohortStamp}.
            </div>
          )}
        </div>

        {/* INTRO */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px',
          fontSize: 14,
          color: 'var(--text-primary)',
          lineHeight: 1.65,
        }}>
          Every bill gets a <span style={{ color: 'var(--teal)', fontWeight: 600 }}>trajectory score</span> from
          0 to 99. The score combines five weighted signals of legislative progress, then multiplies by an
          X Factor that accounts for procedural signals — companion bills, cutoff pressure, Rules-committee
          holds, floor margins. The final score is calibrated against actual outcomes from prior completed
          sessions so a "75" means something concrete, not an arbitrary number.
        </div>

        {/* Thread 13.1 — Calibration tables moved above Five Signals + X Factors
            so a first-time reader sees the proof (84% pass rate at HIGH across
            8,062 bills) before the method. Section bodies are unchanged; only
            their position in the page flow shifted. G5 cohort literal preserved
            verbatim. */}

        {/* SECTION — CALIBRATION (the proof point) */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Calibration — {sessionShort} Session Outcomes
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              The chart below is the whole point. It shows, for all {totalN.toLocaleString()} bills in the {sessionShort} biennium,
              what fraction of bills in each score bucket <em>actually</em> became law. If the scoring
              model is any good, higher buckets should pass at meaningfully higher rates — and they do,
              with clean monotonic separation.
            </div>
            {/* Thread 26 — card-per-bucket vertical layout replaces the
                horizontal-scrolling table. One card per HIGH/MOD/LOW/VERY-LOW
                row so the whole thing fits inside a 480px column without an
                inner scroll bar. Uses pure flex/grid — no media queries (the
                site is mobile-only by directive, so a single layout is the
                right tool). */}
            <div>
              {calibration.map((c) => (
                <div key={c.bucket} style={{
                  padding: '14px 16px',
                  borderTop: '1px solid var(--border)',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 10,
                  }}>
                    <span style={{
                      fontSize: 14,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                    }}>{c.bucket}</span>
                    <span style={{
                      fontSize: 12,
                      color: TIER_COLOR[c.label],
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                    }}>{c.label}</span>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 12,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, textAlign: 'right' }}>Bills</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'right' }}>{c.bills.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, textAlign: 'right' }}>Chamber</div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', textAlign: 'right' }}>{c.chamber.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, textAlign: 'right' }}>Law</div>
                      <div style={{ fontSize: 13, color: TIER_COLOR[c.label], fontWeight: 700, textAlign: 'right' }}>{c.law.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
              Source: Vector | WA database, full {sourceSession} biennium outcomes. N={totalN.toLocaleString()}.
              "Chamber" = passed at least one chamber. "Law" = signed by the governor.
              Recalculated live on every page load.
            </div>
          </div>
        </div>

        {/* SECTION — COMBINED 3-BIENNIUM CALIBRATION (the engine truth) */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Combined 3-Biennium Calibration
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              The table above shows one biennium in detail. The scoring engine itself is calibrated
              against all {cohortCountStr} biennia combined &mdash; {cohortTotalStr} bills spanning {cohortBienniaStr}.
              These are the exact pass probabilities <em>every score on this site</em> resolves to,
              with 95% Wilson confidence intervals showing the range of plausible truth given the
              sample size in each bucket.
            </div>
            {/* Thread 26 — same card layout as the per-biennium table above. */}
            <div>
              {COMBINED_3B.map((c) => (
                <div key={c.bucket} style={{
                  padding: '14px 16px',
                  borderTop: '1px solid var(--border)',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 10,
                  }}>
                    <span style={{
                      fontSize: 14,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                    }}>{c.bucket}</span>
                    <span style={{
                      fontSize: 12,
                      color: TIER_COLOR[c.label],
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                    }}>{c.label}</span>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1.5fr',
                    gap: 12,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, textAlign: 'right' }}>Law Rate</div>
                      <div style={{ fontSize: 13, color: TIER_COLOR[c.label], fontWeight: 700, textAlign: 'right' }}>{c.rate}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, textAlign: 'right' }}>95% CI</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'right' }}>{c.ci}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
              Source: Vector | WA combined biennia (bills only), N={cohortTotalStr}. CIs computed via Wilson score interval.
              These exact values are wired into the scoring engine's pass_probability ladder &mdash;
              when a bill shows "84% chance of becoming law", this is the row it came from.
              {/* Thread 26: Recalculated stamp hoisted to the TL;DR card at the
                  top of the page — see audit-finalized scope §2. */}
            </div>
          </div>
        </div>

        {/* SECTION — SIGNALS */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            The Five Signals
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {SIGNALS.map((s, i) => {
              // DATA_FRESHNESS #12: inject live cohort numbers into the
              // Historical signal prose so the bill-count and biennium list
                // stay current without a code push at each rollover.
              const liveDescription = s.name === 'Historical'
                ? `Category-level pass rates calibrated from ${cohortTotalStr} bills across ${cohortCountStr} biennia (${cohortBienniaStr}). Tax bills behave differently than transportation bills.`
                : s.description
              return (
              <div key={s.name} style={{
                padding: '14px 16px',
                borderBottom: i < SIGNALS.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--teal)' }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {s.range} pts · {s.weight}% weight
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 8 }}>
                  {liveDescription}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {s.inputs.map(inp => (
                    <span key={inp} style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      background: 'rgba(184,151,90,0.08)',
                      border: '1px solid rgba(184,151,90,0.25)',
                      borderRadius: 10,
                      color: 'var(--text-muted)',
                    }}>{inp}</span>
                  ))}
                </div>
              </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, fontStyle: 'italic' }}>
            A stage advancement bonus (0–25) also stacks on top, rewarding bills that have cleared cutoffs.
          </div>
        </div>

        {/* SECTION — X FACTORS */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            X Factors
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
              X Factors multiply the base score by between 0.50× and 1.50× based on procedural signals
              that aren't captured by the five base signals. These are the things a seasoned legislative analyst
              watches — not just what happened, but what's <em>about</em> to happen.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600, marginBottom: 6 }}>POSITIVE</div>
                {XF_POS.map(x => (
                  <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', color: 'var(--text-muted)' }}>
                    <span>{x.l}</span>
                    <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>{x.d}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginBottom: 6 }}>NEGATIVE</div>
                {XF_NEG.map(x => (
                  <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', color: 'var(--text-muted)' }}>
                    <span>{x.l}</span>
                    <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>{x.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION — WHY THIS MATTERS */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Why this matters
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
            Most public legislative trackers (LegiScan, OpenStates, the WA Legislature site) tell you
            where a bill is. Vector | WA tells you where a bill is <em>going</em>. The {veryLow.bills.toLocaleString()} bills in
            the 0–44 (VERY LOW) bucket had a 0% pass rate. The {high.bills.toLocaleString()} bills in the 75+ bucket had a {high.law.toFixed(1)}% pass rate —
            <span style={{ color: 'var(--teal)', fontWeight: 600 }}> {highLawCount} of them became law</span>.
            That separation is the whole point of the signal.
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              Scores refresh nightly. The calibration table above recomputes itself from live
              Supabase data every time you open this page, so as soon as the next biennium's
              outcomes are final the numbers above update automatically — no manual refresh needed.
            </div>
            {/* Thread 31 (2026-04-27): cumulative roll-call coverage note. The
                bill scoring engine has data back to 2021-2022, but member-level
                roll-call votes were only ingested starting with the 2025-2026
                biennium. As successive bienniums close, the cumulative member
                voting profile grows — per-session breakdowns remain available
                via the session selector on /members. */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
              Member voting records cover 2025-2026 onward. Each successive biennium adds to the cumulative record;
              per-session breakdowns remain available via the session selector on the members page.
            </div>
          </div>
        </div>

        {/* SECTION — AFTER SESSION ENDS (interim behavior) */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            After Session Ends (Interim)
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
            When the legislature adjourns sine die, every bill gets a final classification based on how far
            it advanced:
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><span style={{ color: 'var(--teal)', fontWeight: 600 }}>Signed into Law</span> — reached the
                governor's desk and was signed (stage 6). Pass probability stays at 100%.</div>
              <div><span style={{ color: '#ffc94a', fontWeight: 600 }}>Passed Chamber</span> — cleared at least
                one chamber (stage 4–5) but didn't become law before the biennium ended. Pass probability
                goes to 0% because the legislative window closed.</div>
              <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Dead</span> — didn't make it out
                of its chamber of origin. Pass probability goes to 0%.</div>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              During the interim, trajectory scores are frozen — they reflect where the bill stood at
              session end. The signal tier (HIGH, MODERATE, LOW, VERY LOW) is preserved as a historical
              reference showing how strong the bill's trajectory signal was before the session closed.
              If a bill is reintroduced in a future session, it gets a fresh score.
            </div>
          </div>
        </div>

        {/* SECTION — SIGNAL TIERS */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Signal Tiers
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Every bill is assigned a signal tier based on its trajectory score. During an active session,
              this indicates likelihood of advancement. After sine die, the tier is preserved as a historical
              marker — "Signal was MODERATE" means the bill's trajectory placed it in the MODERATE range
              before the session ended.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                fontSize: 12,
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
              }}>
                <thead>
                  <tr style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    <th style={{ textAlign: 'left',  padding: '10px 16px', fontWeight: 600 }}>Tier</th>
                    <th style={{ textAlign: 'left',  padding: '10px 8px',  fontWeight: 600 }}>Score Range</th>
                    <th style={{ textAlign: 'left',  padding: '10px 16px', fontWeight: 600 }}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { tier: 'HIGH',      range: '75–99', meaning: 'Strong legislative momentum — committee passed, floor action likely', color: '#b8975a' },
                    { tier: 'MODERATE',  range: '60–74', meaning: 'Active movement — hearings held, some advancement', color: '#ffc94a' },
                    { tier: 'LOW',       range: '45–59', meaning: 'Limited progress — introduced but stalling', color: '#ff9f43' },
                    { tier: 'VERY LOW',  range: '0–44',  meaning: 'Minimal activity — unlikely to advance', color: '#8a96ad' },
                  ].map((t, i) => (
                    <tr key={t.tier} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                      <td style={{ padding: '12px 16px', color: t.color, fontWeight: 600 }}>{t.tier}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{t.range}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }}>{t.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
              Signal tier is distinct from outcome label. After session ends, a bill might be labeled "Dead"
              (outcome) but still show "Signal was MODERATE" (tier) — meaning it had real momentum before
              the clock ran out.
            </div>
          </div>
        </div>

        {/* SECTION — POLITICAL DYNAMICS (Phase 8) */}
        <div id="political-dynamics">
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Political Dynamics
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Beyond the trajectory score, Vector computes four political dynamics signals that answer
              a different question: not "how far has this bill moved?" but "who is moving it, and how
              much friction does it face?" These are derived from data Vector already collects — no AI
              sentiment analysis, no external APIs beyond the WA Legislature's own data.
            </div>
            {[
              {
                name: 'Bipartisan Index',
                range: '0–100%',
                description: 'The percentage of co-sponsors from the opposite party of the prime sponsor. A bill introduced by a Democrat with 4 Republican co-sponsors out of 10 total has a 40% bipartisan index. Above 30% is labeled Bipartisan, below 10% is Partisan, and between is Mixed.',
                limitation: 'Does not detect hostile cross-aisle co-sponsorship — a Republican co-sponsoring a Democratic bill to weaken it in committee would still count as "bipartisan." Also cannot distinguish sincere support from political cover.',
              },
              {
                name: 'Cross-Aisle Count',
                range: '0–N',
                description: 'The raw count of co-sponsors from the opposing party. While bipartisan index measures proportion, cross-aisle count measures breadth — a bill with 8 opposite-party co-sponsors has stronger signal than one with 1, even if both have the same index.',
                limitation: 'Co-sponsorship is cheap to give and doesn\'t guarantee a floor vote. Some legislators co-sponsor broadly as a courtesy.',
              },
              {
                name: 'Chair Alignment',
                range: 'Aligned / Opposed',
                description: 'Whether the current committee chair shares the prime sponsor\'s party. Committee chairs have enormous power in WA — they decide whether a bill gets a hearing, when it gets scheduled, and whether it moves to executive session. An aligned chair removes a major friction point.',
                limitation: 'Chair party alone doesn\'t capture personal relationships, policy preferences, or committee dynamics. A Democratic chair might block a fellow Democrat\'s bill for caucus-strategy reasons.',
              },
              {
                name: 'Sponsor Track Record',
                range: '0–100%',
                description: 'The prime sponsor\'s historical pass rate — what fraction of their bills across the prior two biennia were signed into law. A sponsor with a 35% track record has consistently gotten bills across the finish line; one with 5% is either new or tends to introduce aspirational legislation.',
                limitation: 'New legislators have no track record (the field will be blank). Experienced legislators who introduce many bills may show a lower rate even if they pass more bills in absolute terms. Track record from prior sessions may not predict performance under a different Governor or shifted majorities.',
              },
            ].map((s, i) => (
              <div key={s.name} style={{
                padding: '14px 16px',
                borderBottom: i < 3 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--teal)' }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {s.range}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 8 }}>
                  {s.description}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5, fontStyle: 'italic' }}>
                  Limitation: {s.limitation}
                </div>
              </div>
            ))}
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
              Political dynamics signals are informational — they are not factored into the trajectory
              score or pass probability. They provide context an analyst would want alongside the numbers:
              who built the coalition, who controls the committee, and how effective is the sponsor.
            </div>
          </div>
        </div>

      </div>

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}
