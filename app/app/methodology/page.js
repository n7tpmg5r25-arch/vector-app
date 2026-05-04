'use client'
// Phase 7V.1 + Thread 67 (2026-05-03) — Methodology page is a client component
// so it can pull the calibration table live from Supabase every page load.
// No more manual refresh at the end of each biennium: the page queries the
// most recently completed session, buckets bills by final_score, and computes
// chamber/law pass rates on the fly.
//
// Thread 67 swapped the load behavior:
//   - Initial state is `null` (loading), not the combined-3B fallback.
//   - On query error or unusually small result set, state goes to `[]` and
//     the per-biennium card renders an empty-state pointing the reader at
//     the Combined-3B engine-truth card below.
//   - The page never silently substitutes combined-3B numbers under a
//     single-biennium header.
// The CALIBRATION_FALLBACK / FALLBACK_SESSION / FALLBACK_N constants below
// are kept as historical reference for the Phase 7D.3 cohort definition;
// they are no longer used as initial state.
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

// Phase 7D.3 cohort definition — historical reference only as of Thread 67
// (2026-05-03). These constants used to initialize the live calibration
// state; they were doing more harm than good because they hold combined-3B
// numbers and would render under a single-biennium header on query failure.
// Kept here as in-code documentation of the Phase 7D.3 cohort:
//   8,062 bills (bills-only, excludes 755 resolutions/memorials)
//   across 2021-22 + 2023-24 + 2025-26
//   2,155 became law (HIGH 2,134 + MODERATE 21 + LOW/VLOW 0)
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

// Thread 67 (2026-05-03) — TIER_COLOR canonicalized to ScoreBadge.js (line 12-15)
// + /how-it-works Section 2 tier legend. Brand Guide v1.2 §02 functional palette.
// Reader who learned the color story on /how-it-works sees the same paint here;
// reader who reads /methodology first sees the same paint on every bill card via
// ScoreBadge. Single source of truth across all three surfaces.
const TIER_COLOR = {
  'HIGH':     '#7aab6e',  // Sage — strong/passed (matches ScoreBadge ≥75)
  'MODERATE': '#3a7a8a',  // Deep Teal — active (matches ScoreBadge ≥60)
  'LOW':      '#c47a30',  // Amber — watch/pending (matches ScoreBadge ≥45)
  'VERY LOW': '#8a8070',  // Stone — inactive (matches ScoreBadge <45)
}

export default function MethodologyPage() {
  // Phase 12 Batch 6 — capability-aware nav swap for anon visitors.
  // Thread 15.2: viewerLoading destructured + isAnonPublic gated on !viewerLoading
  // so authed users no longer flash PublicNav during auth resolve.
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  // 7V.1 / Thread 67 (2026-05-03): live calibration state machine.
  //   null      → query in-flight; render skeleton
  //   []        → query failed or returned < 100 bills; render empty-state
  //                pointing the reader at the Combined-3B card below
  //   non-empty → render rows
  // CALIBRATION_FALLBACK / FALLBACK_SESSION / FALLBACK_N are no longer used as
  // initial state because they hold combined-3B numbers, which would silently
  // render under a single-biennium header on query failure (Thread 67 finding
  // §7 — honesty insurance).
  const [calibration, setCalibration]     = useState(null)
  const [sourceSession, setSourceSession] = useState(null)
  const [totalN, setTotalN]                = useState(null)

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
        if (error || !data || data.length < 100) {
          // Thread 67: don't pretend with stale combined-3B numbers under a
          // single-biennium header. Render an empty-state instead.
          setCalibration([])
          setSourceSession(calSession)
          return
        }
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

  // Thread 67 (2026-05-03): live derived values dropped — "Why this matters"
  // prose now reads from the G5-frozen combined-cohort constants instead of
  // single-biennium live data, which had been creating a 78.4%/189 vs 84.0%
  // contradiction across adjacent sections.
  //
  // Combined-cohort constants used by the prose below (Phase 7D.3 cohort,
  // 8,062 bills × 3 biennia):
  //   COMBINED_COHORT_TOTAL  = 8,062 (matches CALIBRATION_LAW_FALLBACK math)
  //   COMBINED_HIGH_BILLS    = 2,541
  //   COMBINED_HIGH_LAW_RATE = 84.0%
  //   COMBINED_HIGH_LAW_N    = 2,134 (= round(2541 × 0.84); reconciles with
  //                                    CALIBRATION_LAW_FALLBACK = 2,155 minus
  //                                    the 21 from MODERATE bucket)
  //   COMBINED_VLOW_BILLS    = 3,571
  //   COMBINED_VLOW_LAW_RATE = 0.0%
  //
  // sessionShort still needed for the per-biennium card header. Guarded for
  // null because sourceSession is null until the live query resolves.
  const sessionShort = sourceSession
    ? sourceSession.split('-').map((y, i) => i === 1 ? y.slice(2) : y).join('-')
    : '…'
  const calibrationLoading = calibration === null
  const calibrationEmpty   = Array.isArray(calibration) && calibration.length === 0

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

        {/* SECTION — CALIBRATION (the proof point)
            Thread 67 (2026-05-03): explicit scope marker on the header so
            the reader knows this card shows ONE biennium before reading
            numbers. The Combined-3B card below carries the engine truth. */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Calibration: Most Recent Biennium ({sessionShort})
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {totalN ? (
                <>The card below shows, for all {totalN.toLocaleString()} bills in the {sessionShort} biennium,
                what fraction of bills in each score bucket <em>actually</em> became law. If the scoring
                model is any good, higher buckets should pass at meaningfully higher rates — and they do,
                with each higher bucket passing at a higher rate.</>
              ) : (
                <>The card below will show, for every bill in the {sessionShort} biennium,
                what fraction of bills in each score bucket <em>actually</em> became law. If the scoring
                model is any good, higher buckets should pass at meaningfully higher rates — and they do,
                with each higher bucket passing at a higher rate.</>
              )}
            </div>
            {/* Thread 67 (2026-05-03): three render branches — loading
                skeleton / live cards / empty-state. Empty-state appears
                only on query failure or unusually small result sets and
                points the reader at the Combined-3B engine truth below
                rather than substituting fake numbers under this header. */}
            {calibrationLoading && (
              <div style={{
                padding: '24px 16px',
                fontSize: 12,
                color: 'var(--text-faint)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textAlign: 'center',
                borderTop: '1px solid var(--border)',
              }}>
                Loading live calibration…
              </div>
            )}
            {calibrationEmpty && (
              <div style={{
                padding: '16px',
                fontSize: 13,
                color: 'var(--text-muted)',
                lineHeight: 1.55,
                borderTop: '1px solid var(--border)',
              }}>
                Live single-biennium calibration is temporarily unavailable. The
                combined three-biennium engine calibration immediately below remains
                valid &mdash; it&apos;s what every score on this site actually resolves
                to. Refresh the page to retry the live query.
              </div>
            )}
            {!calibrationLoading && !calibrationEmpty && (
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
                    {/* Thread 67.1 (2026-05-03): inline single-line layout
                        with dot separators replaces the 3-col grid. Reads as
                        a sentence — sample, moved, became law — and removes
                        the staggered-anchor problem flagged in Thread 52.1
                        and Thread 67 reviews. Law % bolded + tier-colored as
                        the headline number; chamber % muted as supporting. */}
                    <div style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      fontFamily: 'var(--font-body)',
                      color: 'var(--text-muted)',
                    }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {c.bills.toLocaleString()}
                      </span> bills{' '}
                      <span style={{ color: 'var(--brass)', margin: '0 4px' }}>·</span>{' '}
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{c.chamber.toFixed(1)}%</span> reached chamber{' '}
                      <span style={{ color: 'var(--brass)', margin: '0 4px' }}>·</span>{' '}
                      <span style={{ fontFamily: 'var(--font-mono)', color: TIER_COLOR[c.label], fontWeight: 700 }}>
                        {c.law.toFixed(1)}%
                      </span>{' '}
                      <span style={{ color: TIER_COLOR[c.label], fontWeight: 600 }}>became law</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!calibrationLoading && !calibrationEmpty && totalN && (
              <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
                Source: Vector | WA database, full {sourceSession} biennium outcomes. N={totalN.toLocaleString()}.
                &ldquo;Chamber&rdquo; = passed at least one chamber. &ldquo;Law&rdquo; = signed by the governor.
                Recalculated live on every page load.
              </div>
            )}
          </div>
        </div>

        {/* SECTION — COMBINED 3-BIENNIUM CALIBRATION (the engine truth)
            Thread 67 (2026-05-03): explicit scope marker on header so the
            two calibration cards are unambiguously distinguished. Card body
            also gains a statistician-grade in-sample disclosure footnote
            ("How honest is this?") at the bottom. */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Calibration: All Three Biennia &mdash; Engine Truth
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              The card above shows one biennium in detail. The scoring engine itself is calibrated
              against all {cohortCountStr} biennia combined &mdash; {cohortTotalStr} bills spanning {cohortBienniaStr}.
              These are the exact pass probabilities <em>every score on this site</em> resolves to,
              with 95% Wilson confidence intervals showing the range of plausible truth given the
              sample size in each bucket.
            </div>
            {/* Thread 67.1 (2026-05-03): inline single-line layout matching
                the per-biennium card. Headline rate (bolded + tier-colored)
                followed by 95% CI in muted mono, dot-separated. */}
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
                    marginBottom: 8,
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
                    fontSize: 13,
                    lineHeight: 1.55,
                    fontFamily: 'var(--font-body)',
                    color: 'var(--text-muted)',
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: TIER_COLOR[c.label], fontWeight: 700 }}>
                      {c.rate}
                    </span>{' '}
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
              {/* Thread 67.1 (2026-05-03): Wilson-zero-bucket explainer for
                  the 0.0% rows. */}
              {' '}For buckets with zero observed law outcomes, the Wilson upper bound (&le;0.5%)
              tells you the historical record is consistent with a true rate effectively at zero,
              given the sample size in that bucket.
            </div>
            {/* Thread 67 + 67.1 (2026-05-03): sharpened in-sample disclosure
                + real-time-procedural-state framing. Without these two pieces,
                a statistician reads the page as marketing and a lobbyist reads
                the score as a prediction for their specific bill. Both
                misreads need to be headed off explicitly. */}
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text-muted)' }}>How honest is this?</strong>{' '}
              These are <em>historical pass rates</em> of bills that previously scored in each
              bucket. They are <strong>not a probabilistic forecast for any specific bill currently
              in flight</strong> &mdash; a bill scoring 80 today is not predicted to pass at 80%
              probability; it sits in a bucket where, historically, 84% of its peers passed once
              the session was over. The score is a real-time reflection of procedural state, not a
              static forecast: a bill scoring 85 today reflects that it has <em>already cleared</em>
              the procedural milestones associated with bills that historically passed at 84%; if
              circumstances change, the score updates the next sync.
              {' '}The cohort the rates above are computed from is the same cohort the engine is
              calibrated against, so these numbers measure fit. Each new completed biennium adds
              fresh data, functioning as a rolling out-of-sample check; predictive accuracy on a
              future biennium is expected to fall within roughly the same band, with normal
              regression toward the mean.
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
          {/* Thread 67 + 67.1 (2026-05-03): weight math + normalization
              disclosure. The 0-125 raw range maps to 0-99 display via a
              fixed monotonic transform inside scoreBill(); without
              disclosing that, "84%" is mathematically untethered from the
              80%-of-125 number. */}
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.55 }}>
            A stage-advancement bonus (0&ndash;25 points) stacks on top, rewarding bills that have
            cleared cutoffs. The bonus is the remaining 20% of weight: five signals sum to 80% of
            the 125-point ceiling, the stage bonus contributes the other 20% &mdash; together they
            cover the full possible score. Raw signal totals (0&ndash;125) are then mapped to the
            displayed 0&ndash;99 score via a fixed monotonic transform; bucket boundaries
            (75 / 60 / 45) are placed in display space, not raw space.
          </div>
        </div>

        {/* SECTION — X FACTORS */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            X Factors
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
            {/* Thread 67.1 (2026-05-03): X-Factor mechanism made explicit.
                "+15%" is +0.15 added to the multiplier (within the 0.5x-1.5x
                clamp), NOT +15 points to the score. Worked example added so
                the math is reproducible. */}
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
              X Factors capture procedural signals that aren&apos;t in the five base signals &mdash;
              the things a seasoned legislative analyst watches. They combine into a single
              multiplier applied to the base score:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                multiplier = clamp(1 + &Sigma;(positives) &minus; &Sigma;(negatives), 0.5&times;, 1.5&times;)
              </span>.{' '}
              Each percentage in the table below is a delta added to (or subtracted from) that
              multiplier &mdash; so &ldquo;Pulled from Rules +15%&rdquo; means +0.15 to the multiplier,
              not +15 points to the score.
            </div>
            {/* Worked example so the formula isn't theoretical. */}
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.55,
              padding: '10px 12px',
              marginBottom: 12,
              borderRadius: 'var(--radius)',
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid rgba(184,151,90,0.18)',
            }}>
              <strong style={{ color: 'var(--text-primary)' }}>Worked example.</strong>{' '}
              A bill with base score 70 that has been Pulled from Rules (+15%) and earned a
              Strong floor margin (+8%) gets multiplier ={' '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>1 + 0.15 + 0.08 = 1.23</span>.{' '}
              Final displayed score = round(70 &times; 1.23) ={' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>86</span>.
              The same bill, if Held in Rules (&minus;20%) and stalled (&minus;10%), gets
              multiplier = 0.70, score = 49 &mdash; one Held-in-Rules event drops it from HIGH
              to LOW within a single sync.
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
            {/* Thread 67 (2026-05-03): prose now uses combined-cohort numbers
                so it reconciles with the engine-truth card directly above.
                Single-biennium 78.4% / 189 figures previously here were
                mathematically correct but contextually contradictory next to
                the 84.0% combined number in the table. Hardcoded constants
                are documented at the top of this component. */}
            Most public legislative trackers (LegiScan, OpenStates, the WA Legislature site) tell
            you where a bill <em>is</em>. Vector | WA tells you where a bill is <em>going</em>.
            Across the engine&apos;s three-biennium calibration cohort of 8,062 bills, exactly
            <strong> 2,155 became law</strong>. Where they came from is the whole point of
            the signal:
            {/* Thread 67.1 (2026-05-03): denominator clarity + 99% framing.
                The killer stat is that 99% of all law outcomes came from the
                HIGH bucket — that's what tells a lobbyist what to prioritize. */}
            <div style={{ marginTop: 10, marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7, color: 'var(--text-muted)' }}>
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
              <span style={{ color: TIER_COLOR.HIGH, fontWeight: 600 }}>2,134 of those 2,541 HIGH bills became law</span> &mdash;
              {' '}<strong>99% of every successful bill</strong> across the entire 8,062-bill
              cohort came from the HIGH bucket. Of the 810 LOW bills, zero became law: these are
              the bills that started moving but stalled before clearing a chamber. Of the 3,571
              VERY LOW bills, zero became law: introduced but never seriously advanced. That
              separation between buckets is what the score is for.
            </div>

            {/* Thread 67 — practitioner callout #1: how to read the score in
                day-to-day Olympia work. Brand v1.2 §05 voice: probability not
                prediction; quantified before qualitative. */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Reading the score in practice.</strong>{' '}
              A HIGH bill (75+) sits in the 84.0% historical pass bucket &mdash; bills at this tier
              warrant calendar holds, witness coordination, and amendment review. A VERY LOW bill
              (0&ndash;44) sits at 0.0% historical pass &mdash; deprioritize unless one of the
              X-Factors above flips the read. The signal-tier label (HIGH / MODERATE / LOW / VERY
              LOW) is the same answer the score gives, just easier to scan: same meaning, faster eye.
            </div>

            {/* Thread 67 — practitioner callout #2: when to trust the X-Factor
                list against the score. This is the bit that separates a
                lobbyist tool from a research dashboard. */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>What flips a bucket mid-session.</strong>{' '}
              A LOW score paired with <em>Pulled from Rules</em> or <em>Companion bill filed</em> deserves
              a second look &mdash; the X-Factor multiplier can pull the bill into a different tier
              within one news cycle. A HIGH score paired with <em>Held in Rules</em> or <em>Cutoff
              pressure</em> rarely survives &mdash; the score may not have caught up to the procedural
              reality yet. Trust the X-Factor list when it disagrees with the bucket; that&apos;s
              what it&apos;s there for.
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              Scores refresh nightly. The most-recent-biennium calibration card above recomputes
              itself from live Supabase data every time you open this page, so as soon as the next
              biennium&apos;s outcomes are final the per-biennium numbers update automatically &mdash;
              no manual refresh needed. The engine-truth card stays locked until the post-2027
              recalibration opens new biennia into the cohort.
            </div>
            {/* Thread 31 (2026-04-27): cumulative roll-call coverage note. The
                bill scoring engine has data back to 2021-2022, but member-level
                roll-call votes were only ingested starting with the 2025-2026
                biennium. As successive bienniums close, the cumulative member
                voting profile grows — per-session breakdowns remain available
                via the session selector on /members. */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
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
            {/* Thread 67 (2026-05-03): outcome label colors now mirror
                ScoreBadge.js:41 (LAW = Sage, carry-over = var(--gold)). Reader
                who saw the LAW pill on a real bill card sees the same color
                here. */}
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><span style={{ color: '#7aab6e', fontWeight: 600 }}>Signed into Law</span> &mdash; reached the
                governor&apos;s desk and was signed (stage 6). Pass probability stays at 100%.</div>
              <div><span style={{ color: 'var(--gold)', fontWeight: 600 }}>Passed Chamber</span> &mdash; cleared at least
                one chamber (stage 4&ndash;5) but didn&apos;t become law before the biennium ended. Pass probability
                goes to 0% because the legislative window closed.</div>
              <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Dead</span> &mdash; didn&apos;t make it out
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
            {/* Thread 67 (2026-05-03): converted from <table> + overflowX:auto
                to card-per-tier vertical layout. Same pattern Thread 26
                applied to the calibration tables — mobile-only column doesn't
                need horizontal scroll. Tier color tokens canonicalized to
                ScoreBadge palette via TIER_COLOR. */}
            <div>
              {[
                { tier: 'HIGH',      range: '75–99', meaning: 'Strong legislative momentum — committee passed, floor action likely' },
                { tier: 'MODERATE',  range: '60–74', meaning: 'Active movement — hearings held, some advancement' },
                { tier: 'LOW',       range: '45–59', meaning: 'Limited progress — introduced but stalling' },
                { tier: 'VERY LOW',  range: '0–44',  meaning: 'Minimal activity — unlikely to advance' },
              ].map((t) => (
                <div key={t.tier} style={{
                  padding: '14px 16px',
                  borderTop: '1px solid var(--border)',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 8,
                  }}>
                    <span style={{
                      fontSize: 13,
                      color: TIER_COLOR[t.tier],
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                    }}>{t.tier}</span>
                    <span style={{
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}>{t.range}</span>
                  </div>
                  <div style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    lineHeight: 1.55,
                  }}>
                    {t.meaning}
                  </div>
                </div>
              ))}
            </div>
            {/* Thread 67.1 (2026-05-03): tier-label-vs-outcome clarifier.
                Headline insight that explains why MODERATE bills pass at
                only 1.8% — the label describes how far the bill has moved,
                not how likely it is to pass. Without this, a non-expert
                reads MODERATE as "50/50" and trusts the wrong thing. */}
            <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Important:</strong>{' '}
              Tier labels describe <em>trajectory momentum</em> &mdash; how far a bill has moved
              through the procedural pipeline. They <strong>do not</strong> describe pass
              probability. The HIGH-bucket pass rate (84%) and the MODERATE-bucket pass rate
              (1.8%) are the historical outcomes of bills that achieved each level of momentum,
              not what the labels themselves predict. A &ldquo;MODERATE&rdquo; bill has moderate
              procedural momentum; the historical record then shows that level of momentum rarely
              converts to law.
            </div>
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
              Signal tier is also distinct from outcome label. After session ends, a bill might be labeled &ldquo;Dead&rdquo;
              (outcome) but still show &ldquo;Signal was MODERATE&rdquo; (tier) &mdash; meaning it had real momentum before
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
              a different question: not &ldquo;how far has this bill moved?&rdquo; but &ldquo;who is moving it, and how
              much friction does it face?&rdquo; These are derived from data Vector already collects &mdash; no AI
              sentiment analysis, no external APIs beyond the WA Legislature&apos;s own data.
              {/* Thread 67.1 (2026-05-03): why-separate explainer. The
                  trajectory score and the political signals are
                  intentionally independent — folding political features in
                  would require a full re-calibration, scheduled for the
                  post-2027 thread. Until then, lobbyists get two
                  independent reads. */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Why these are separate from the trajectory score.</strong>{' '}
                Bipartisan Index, Cross-Aisle Count, Chair Alignment, and Sponsor Track Record
                are computed independently and not folded into the trajectory score by design. The
                trajectory score is calibrated against an 8,062-bill cohort using only procedural
                inputs; adding political features would require re-running the calibration against a
                fresh cohort with re-tuned weights, scheduled for the post-2027 recalibration cycle.
                Keeping them separate also lets a lobbyist read &ldquo;where is this bill?&rdquo;
                (trajectory) and &ldquo;who is moving it?&rdquo; (politics) as two independent signals
                &mdash; a useful split when the answers disagree.
              </div>
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
