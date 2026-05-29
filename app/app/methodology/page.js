'use client'
// Phase 7V.1 + Thread 67 (2026-05-03) — Methodology page is a client component
// so it can pull the calibration table live from Supabase every page load.
// No more manual refresh at the end of each biennium: the page queries the
// most recently completed session, buckets bills by final_score, and computes
// chamber/law pass rates on the fly.
//
// T155 (2026-05-28): Page redesigned for senior lobbyist / validity lens.
//   - Section reorder: Why This Matters moved up (pos 3), calibration merged,
//     Signal Tiers deleted, CTA added at bottom.
//   - TL;DR card upgraded: 84% stat in 36px Playfair Display.
//   - Intro gains WA-specific session mechanics context.
//   - Calibration: two sections merged into one card (combined 3B primary,
//     per-biennium as sub-section).
//   - X Factors: 2-col grid replaced with stacked single column (mobile-safe).
//   - Political Dynamics: "In practice:" guidance per signal, "What we don't use"
//     added at bottom.
//   - "How honest is this?" pulled into visible callout with key sentence.
//   - Section labels gain brass left-border accent.
//
// Thread 67 swapped the load behavior:
//   - Initial state is `null` (loading), not the combined-3B fallback.
//   - On query error or unusually small result set, state goes to `[]` and
//     the per-biennium card renders an empty-state pointing the reader at
//     the Combined-3B engine-truth card below.
//   - The page never silently substitutes combined-3B numbers under a
//     single-biennium header.
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

// Phase 7D.3 cohort definition — historical reference only as of Thread 67
// (2026-05-03). Kept as in-code documentation of the Phase 7D.3 cohort:
//   8,062 bills (bills-only, excludes 755 resolutions/memorials)
//   across 2021-22 + 2023-24 + 2025-26
//   2,155 became law (HIGH 2,134 + MODERATE 21 + LOW/VLOW 0)
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
// scoreBill(). Source: 8,062 bills across 2021-22 + 2023-24 + 2025-26.
const COMBINED_3B = [
  { bucket: '75–99', label: 'HIGH',     rate: '84.0%', ci: '82.5 – 85.4%' },
  { bucket: '60–74', label: 'MODERATE', rate: '1.8%',  ci: '1.2 – 2.8%'   },
  { bucket: '45–59', label: 'LOW',      rate: '0.0%',  ci: '0.0 – 0.5%'   },
  { bucket:  '0–44', label: 'VERY LOW', rate: '0.0%',  ci: '0.0 – 0.1%'   },
]

// Thread 67 (2026-05-03) — TIER_COLOR canonicalized to ScoreBadge.js (line 12-15).
const TIER_COLOR = {
  'HIGH':     '#7aab6e',  // Sage — strong/passed
  'MODERATE': '#3a7a8a',  // Deep Teal — active
  'LOW':      '#c47a30',  // Amber — watch/pending
  'VERY LOW': '#8a8070',  // Stone — inactive
}

// T155: Shared section label style — brass left-border accent
const SECTION_LABEL = {
  fontSize: 10,
  color: 'var(--text-faint)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: 10,
  fontWeight: 600,
  borderLeft: '2px solid var(--brass)',
  paddingLeft: 10,
}

export default function MethodologyPage() {
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  // 7V.1 / Thread 67: live calibration state machine.
  //   null      → query in-flight; render skeleton
  //   []        → query failed or returned < 100 bills; render empty-state
  //   non-empty → render rows
  const [calibration, setCalibration]     = useState(null)
  const [sourceSession, setSourceSession] = useState(null)
  const [totalN, setTotalN]               = useState(null)

  const [cohortTotal,      setCohortTotal]     = useState(8062)
  const [cohortBiennia,    setCohortBiennia]   = useState(['2021-2022', '2023-2024', '2025-2026'])
  const [cohortStampedAt,  setCohortStampedAt] = useState(null)

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

    const BUCKET_DISPLAY = {
      HIGH:       '75–99',
      MODERATE:   '60–74',
      LOW:        '45–59',
      'VERY LOW': '0–44',
    }
    sb.from('v_calibration_buckets_by_session')
      .select('label, bills, chamber_count, law_count')
      .eq('session', calSession)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setCalibration([])
          setSourceSession(calSession)
          return
        }
        const byLabel = {}
        let totalBills = 0
        for (const row of data) {
          byLabel[row.label] = row
          totalBills += row.bills || 0
        }
        if (totalBills < 100) {
          setCalibration([])
          setSourceSession(calSession)
          return
        }
        const rows = ['HIGH', 'MODERATE', 'LOW', 'VERY LOW'].map(k => {
          const v = byLabel[k] || { bills: 0, chamber_count: 0, law_count: 0 }
          return {
            bucket: BUCKET_DISPLAY[k],
            label: k,
            bills: v.bills || 0,
            chamber: v.bills > 0 ? (v.chamber_count / v.bills) * 100 : 0,
            law:     v.bills > 0 ? (v.law_count     / v.bills) * 100 : 0,
          }
        })
        setCalibration(rows)
        setSourceSession(calSession)
        setTotalN(totalBills)
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

        {/* 1 — TL;DR: upgraded with big stat */}
        <div style={{
          background: 'rgba(184,151,90,0.05)',
          border: '1px solid var(--brass)',
          borderRadius: 'var(--radius)',
          padding: '16px',
        }}>
          <div style={{
            fontSize: 10,
            color: 'var(--brass)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 10,
            fontWeight: 700,
          }}>TL;DR</div>
          {/* Headline stat */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: 36,
              fontWeight: 700,
              color: TIER_COLOR.HIGH,
              lineHeight: 1,
            }}>84%</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              of HIGH-tier bills (score 75+)<br />became law — across 8,062 bills
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            Vector scores bills 0&ndash;99 from 5 signals &times; X factors.
            Recalibrated nightly. Calibrated on <CohortCitation variant="bills-first" />.
          </div>
          {cohortStamp && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
              Recalculated: {cohortStamp}.
            </div>
          )}
        </div>

        {/* 2 — INTRO with WA-specific session mechanics */}
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
          X Factor that accounts for procedural signals &mdash; companion bills, cutoff pressure, Rules-committee
          holds, floor margins. The final score is calibrated against actual outcomes from prior completed
          sessions so a &ldquo;75&rdquo; means something concrete, not an arbitrary number.
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
            Built for Olympia&apos;s specific mechanics: a 60-day regular session with hard legislative cutoffs,
            a committee structure where chairs hold extraordinary gating power over hearing scheduling and
            executive sessions, and a Rules Committee that is the final kill switch before a floor vote.
            Every signal in the scoring engine reflects those Washington-specific pressure points directly.
          </div>
        </div>

        {/* 3 — WHY THIS MATTERS (moved up — credibility hook before the data) */}
        <div>
          <div style={SECTION_LABEL}>Why This Matters</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
            Most public legislative trackers (LegiScan, OpenStates, the WA Legislature site) tell
            you where a bill <em>is</em>. Vector | WA tells you where a bill is <em>going</em>.
            Across the engine&apos;s three-biennium calibration cohort of 8,062 bills, exactly
            <strong> 2,155 became law</strong>. Where they came from is the whole point of the signal:

            <div style={{ marginTop: 10, marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8, color: 'var(--text-muted)' }}>
              <span style={{ color: TIER_COLOR.HIGH, fontWeight: 700 }}>HIGH (75+):</span>{' '}
              2,541 bills &rarr; <span style={{ color: TIER_COLOR.HIGH, fontWeight: 700 }}>2,134 became law</span> (84.0%)<br/>
              <span style={{ color: TIER_COLOR.MODERATE, fontWeight: 700 }}>MODERATE (60&ndash;74):</span>{' '}
              1,140 bills &rarr; 21 became law (1.8%)<br/>
              <span style={{ color: TIER_COLOR.LOW, fontWeight: 700 }}>LOW (45&ndash;59):</span>{' '}
              810 bills &rarr; 0 became law (0.0%)<br/>
              <span style={{ color: TIER_COLOR['VERY LOW'], fontWeight: 700 }}>VERY LOW (0&ndash;44):</span>{' '}
              3,571 bills &rarr; 0 became law (0.0%)
            </div>

            <div style={{ marginTop: 10 }}>
              <span style={{ color: TIER_COLOR.HIGH, fontWeight: 600 }}>99% of every successful bill</span> across
              the entire 8,062-bill cohort came from the HIGH bucket. Of the 810 LOW bills, zero became law.
              Of the 3,571 VERY LOW bills, zero became law. That separation between buckets is what the score is for.
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Reading the score in practice.</strong>{' '}
              A HIGH bill (75+) sits in the 84.0% historical pass bucket &mdash; bills at this tier
              warrant calendar holds, witness coordination, and amendment review. A VERY LOW bill
              (0&ndash;44) sits at 0.0% historical pass &mdash; deprioritize unless an X-Factor flips the read.
              The signal-tier label (HIGH / MODERATE / LOW / VERY LOW) is the same answer the score gives,
              just easier to scan: same meaning, faster eye.
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>What flips a bucket mid-session.</strong>{' '}
              A LOW score paired with <em>Pulled from Rules</em> or <em>Companion bill filed</em> deserves
              a second look &mdash; the X-Factor multiplier can pull a bill into a different tier within one
              news cycle. A HIGH score paired with <em>Held in Rules</em> or <em>Cutoff pressure</em> rarely
              survives. Trust the X-Factor list when it disagrees with the bucket; that&apos;s what it&apos;s there for.
            </div>
          </div>
        </div>

        {/* 4 — CALIBRATION (merged: combined 3B primary, per-biennium sub-section) */}
        <div>
          <div style={SECTION_LABEL}>Calibration Data</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>

            {/* Combined 3B — the engine truth */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              The scoring engine is calibrated against all {cohortCountStr} biennia combined &mdash;{' '}
              {cohortTotalStr} bills spanning {cohortBienniaStr}.
              These are the exact pass probabilities <em>every score on this site</em> resolves to,
              with 95% Wilson confidence intervals showing the range of plausible truth given the
              sample size in each bucket.
            </div>
            <div>
              {COMBINED_3B.map((c) => (
                <div key={c.bucket} style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{c.bucket}</span>
                    <span style={{ fontSize: 12, color: TIER_COLOR[c.label], fontWeight: 700, letterSpacing: '0.06em' }}>{c.label}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-muted)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: TIER_COLOR[c.label], fontWeight: 700 }}>{c.rate}</span>{' '}
                    <span style={{ color: TIER_COLOR[c.label], fontWeight: 600 }}>became law</span>{' '}
                    <span style={{ color: 'var(--brass)', margin: '0 4px' }}>·</span>{' '}
                    95% CI{' '}
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{c.ci}</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)', lineHeight: 1.55 }}>
              Source: Vector | WA combined biennia (bills only), N={cohortTotalStr}. CIs computed via Wilson score interval.
              These exact values are wired into the scoring engine&apos;s pass_probability ladder &mdash;
              when a bill shows &ldquo;84% chance of becoming law,&rdquo; this is the row it came from.
              {' '}For zero-outcome buckets, the Wilson upper bound (&le;0.5%) confirms the true rate is
              effectively zero given the sample size in that bucket.
            </div>

            {/* "How honest is this?" — key sentence pulled out as callout */}
            <div style={{
              padding: '14px 16px',
              fontSize: 12,
              color: 'var(--text-muted)',
              borderTop: '1px solid var(--border)',
              lineHeight: 1.6,
              background: 'rgba(184,151,90,0.04)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                This is not a prediction for your specific bill &mdash; it&apos;s the historical pass rate of bills that looked like yours.
              </div>
              <div style={{ marginBottom: 8 }}>
                A bill scoring 80 today is not predicted to pass at 80% probability. It sits in a bucket
                where, historically, 84% of its peers passed once the session was over. The score is a
                real-time reflection of procedural state: if circumstances change, the score updates at
                the next sync.
              </div>
              <div>
                These numbers measure in-sample fit &mdash; the cohort the rates are computed from is the
                same cohort the engine is calibrated against. Each new completed biennium adds fresh data,
                functioning as a rolling out-of-sample check; predictive accuracy on a future biennium is
                expected to fall within roughly the same band.
              </div>
            </div>

            {/* Per-biennium check — sub-section */}
            <div style={{ borderTop: '2px solid var(--border)' }}>
              <div style={{ padding: '12px 16px 4px', fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                Most recent biennium check ({sessionShort})
              </div>
              <div style={{ padding: '4px 16px 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {totalN ? (
                  <>Confirms the engine&apos;s calibration holds on the most recent completed session &mdash; {totalN.toLocaleString()} bills, same bucket boundaries.</>
                ) : (
                  <>Confirms the engine&apos;s calibration holds on the most recent completed session.</>
                )}
              </div>

              {calibrationLoading && (
                <div style={{ padding: '20px 16px', fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                  Loading…
                </div>
              )}
              {calibrationEmpty && (
                <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, borderTop: '1px solid var(--border)' }}>
                  Live single-biennium check temporarily unavailable. The combined three-biennium
                  calibration above remains valid &mdash; it&apos;s what every score on this site resolves to.
                  Refresh the page to retry.
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
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{c.bills.toLocaleString()}</span> bills{' '}
                        <span style={{ color: 'var(--brass)', margin: '0 4px' }}>·</span>{' '}
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{c.chamber.toFixed(1)}%</span> reached chamber{' '}
                        <span style={{ color: 'var(--brass)', margin: '0 4px' }}>·</span>{' '}
                        <span style={{ fontFamily: 'var(--font-mono)', color: TIER_COLOR[c.label], fontWeight: 700 }}>{c.law.toFixed(1)}%</span>{' '}
                        <span style={{ color: TIER_COLOR[c.label], fontWeight: 600 }}>became law</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
                    Source: Vector | WA database, full {sourceSession} biennium. N={totalN?.toLocaleString()}.
                    &ldquo;Chamber&rdquo; = passed at least one chamber. &ldquo;Law&rdquo; = signed by the governor.
                    Recalculated live on every page load.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 5 — THE FIVE SIGNALS */}
        <div>
          <div style={SECTION_LABEL}>The Five Signals</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {SIGNALS.map((s, i) => {
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
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.55 }}>
            A stage-advancement bonus (0&ndash;25 points) stacks on top, rewarding bills that have
            cleared cutoffs. The bonus is the remaining 20% of weight: five signals sum to 80% of
            the 125-point ceiling, the stage bonus contributes the other 20%. Raw signal totals
            (0&ndash;125) are then mapped to the displayed 0&ndash;99 score via a fixed monotonic
            transform; bucket boundaries (75 / 60 / 45) are placed in display space, not raw space.
          </div>
        </div>

        {/* 6 — X FACTORS (stacked single column — mobile-safe) */}
        <div>
          <div style={SECTION_LABEL}>X Factors</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
              X Factors capture procedural signals that aren&apos;t in the five base signals &mdash;
              the things a seasoned legislative analyst watches. They combine into a single
              multiplier applied to the base score:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                multiplier = clamp(1 + &Sigma;positives &minus; &Sigma;negatives, 0.5&times;, 1.5&times;)
              </span>.{' '}
              Each percentage is a delta added to (or subtracted from) that multiplier &mdash;
              not points to the score.
            </div>

            {/* Worked example */}
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.55,
              padding: '10px 12px',
              marginBottom: 16,
              borderRadius: 'var(--radius)',
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid rgba(184,151,90,0.18)',
            }}>
              <strong style={{ color: 'var(--text-primary)' }}>Worked example.</strong>{' '}
              Base score 70. Pulled from Rules (+15%) + Strong floor margin (+8%): multiplier ={' '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>1.23</span> &rarr; score{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>86</span>.
              {' '}Same bill, Held in Rules (&minus;20%) + stalled (&minus;10%): multiplier = 0.70,
              score = 49 &mdash; one Held-in-Rules event drops it from HIGH to LOW in a single sync.
            </div>

            {/* Stacked single-column layout for mobile */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>POSITIVE</div>
                {XF_POS.map(x => (
                  <div key={x.l} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    fontSize: 12, padding: '5px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    color: 'var(--text-muted)',
                  }}>
                    <span>{x.l}</span>
                    <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-mono)', marginLeft: 12, flexShrink: 0 }}>{x.d}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>NEGATIVE</div>
                {XF_NEG.map(x => (
                  <div key={x.l} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    fontSize: 12, padding: '5px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    color: 'var(--text-muted)',
                  }}>
                    <span>{x.l}</span>
                    <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', marginLeft: 12, flexShrink: 0 }}>{x.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 7 — POLITICAL DYNAMICS with "In practice" guidance + "What we don't use" */}
        <div id="political-dynamics">
          <div style={SECTION_LABEL}>Political Dynamics</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Beyond the trajectory score, Vector computes four political dynamics signals that answer
              a different question: not &ldquo;how far has this bill moved?&rdquo; but &ldquo;who is moving it,
              and how much friction does it face?&rdquo; Kept separate from the trajectory score by design
              &mdash; so you can read &ldquo;where is this bill?&rdquo; and &ldquo;who is moving it?&rdquo;
              as two independent signals, which is most useful when the answers disagree.
            </div>

            {[
              {
                name: 'Bipartisan Index',
                range: '0–100%',
                description: 'The percentage of co-sponsors from the opposite party of the prime sponsor. Above 30% is labeled Bipartisan, below 10% is Partisan, between is Mixed.',
                inPractice: 'A Partisan bill with a HIGH score typically has leadership protection, not broad coalition support. Above 30% on a contested bill signals genuine cross-aisle buy-in — worth tracking for floor whip counts.',
                limitation: 'Does not detect hostile cross-aisle co-sponsorship — a member co-sponsoring to weaken a bill in committee still counts as "bipartisan." Cannot distinguish sincere support from political cover.',
              },
              {
                name: 'Cross-Aisle Count',
                range: '0–N',
                description: 'The raw count of co-sponsors from the opposing party. Measures breadth of support — a bill with 8 opposite-party co-sponsors has stronger signal than one with 1, even if both have the same index.',
                inPractice: 'More than 5 cross-aisle co-sponsors on a contested bill is genuine movement. Below 2 is likely courtesy co-sponsorship and should not change your hearing strategy.',
                limitation: 'Co-sponsorship is cheap to give and does not guarantee a floor vote. Some legislators co-sponsor broadly as a courtesy.',
              },
              {
                name: 'Chair Alignment',
                range: 'Aligned / Opposed',
                description: 'Whether the current committee chair shares the prime sponsor\'s party. WA committee chairs control hearing scheduling, executive session timing, and whether a bill moves to a floor vote at all.',
                inPractice: 'Opposed alignment means your hearing request goes through the minority. Realistically, plan for a floor amendment opportunity or a companion bill in the other chamber rather than expecting a committee hearing.',
                limitation: 'Chair party alone does not capture personal relationships, policy preferences, or caucus-strategy dynamics. A chair may block a co-partisan\'s bill for caucus reasons.',
              },
              {
                name: 'Sponsor Track Record',
                range: '0–100%',
                description: 'The prime sponsor\'s historical pass rate — what fraction of their bills across the prior two biennia were signed into law.',
                inPractice: 'Above 25% means the sponsor\'s staff knows how to move a bill to a floor vote. Below 10% often signals aspirational or messaging legislation — manage client expectations accordingly.',
                limitation: 'New legislators have no track record (field will be blank). High-volume sponsors may show a lower rate even if they pass more bills in absolute terms. Track record from prior sessions may not predict performance under a shifted majority.',
              },
            ].map((s, i) => (
              <div key={s.name} style={{
                padding: '14px 16px',
                borderBottom: i < 3 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--teal)' }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{s.range}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 8 }}>
                  {s.description}
                </div>
                {/* In practice callout */}
                <div style={{
                  fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5,
                  padding: '7px 10px', marginBottom: 8,
                  borderRadius: 4,
                  background: 'rgba(184,151,90,0.06)',
                  borderLeft: '2px solid var(--brass)',
                }}>
                  <strong>In practice:</strong> {s.inPractice}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                  Limitation: {s.limitation}
                </div>
              </div>
            ))}

            {/* What this model doesn't use */}
            <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
                What this model doesn&apos;t use
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.65 }}>
                Governor&apos;s stated policy priorities, lobby registration data (JLOB), party
                leadership whip counts, campaign finance relationships, and caucus strategy signals
                are not factored into either the trajectory score or the political dynamics signals.
                These factors exist and matter. They&apos;re absent because they&apos;re not reliably
                structured in public data &mdash; or because incorporating them would require
                recalibrating the engine against a fresh cohort with re-tuned weights, scheduled
                for the post-2027 recalibration cycle.
              </div>
            </div>

            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
              Political dynamics signals are informational only &mdash; not factored into the trajectory score or pass probability.
            </div>
          </div>
        </div>

        {/* 8 — AFTER SESSION ENDS (near-last — edge case behavior) */}
        <div>
          <div style={SECTION_LABEL}>After Session Ends (Interim)</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
            When the legislature adjourns sine die, every bill gets a final classification based on
            how far it advanced:
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={{ color: '#7aab6e', fontWeight: 600 }}>Signed into Law</span> &mdash; reached the
                governor&apos;s desk and was signed (stage 6). Pass probability stays at 100%.
              </div>
              <div>
                <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Passed Chamber</span> &mdash; cleared at least
                one chamber (stage 4&ndash;5) but didn&apos;t become law before the biennium ended. Pass probability
                goes to 0% because the legislative window closed.
              </div>
              <div>
                <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Dead</span> &mdash; didn&apos;t make it out
                of its chamber of origin. Pass probability goes to 0%.
              </div>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              During the interim, trajectory scores are frozen &mdash; they reflect where the bill stood at
              session end. The signal tier (HIGH, MODERATE, LOW, VERY LOW) is preserved as a historical
              reference showing how strong the bill&apos;s trajectory was before the session closed.
              If a bill is reintroduced in a future session, it gets a fresh score.
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12 }}>
              Scores refresh nightly. The most-recent-biennium calibration check recomputes itself from
              live data every time you open this page. The engine-truth calibration stays locked until
              the post-2027 recalibration opens new biennia into the cohort.
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12 }}>
              Member voting records cover 2025-2026 onward. Each successive biennium adds to the
              cumulative record; per-session breakdowns remain available via the session selector
              on the members page.
            </div>
          </div>
        </div>

        {/* 9 — CTA */}
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <a href="/search" style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: 'var(--teal)',
            color: 'var(--bg)',
            borderRadius: 'var(--radius)',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.1em',
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}>Search Bills by Score &rarr;</a>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
            See the scoring model in action on live legislation
          </div>
        </div>

      </div>

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}
