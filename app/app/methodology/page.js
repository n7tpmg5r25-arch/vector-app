'use client'
import Nav from '../components/Nav'

// Phase 6.7 — Methodology page. This is the "accuracy proof point" for
// skeptical clients: it explains the 5 signal components, the X factor
// multipliers, the calibrated pass-likelihood buckets, and — most importantly —
// shows the ACTUAL observed pass rates from the completed 2025-26 session,
// which validate the scoring model with clean monotonic separation.
//
// The bucket numbers below are computed directly from the 2025-26 final
// outcomes in the bills table (outcome_passed_law / outcome_passed_chamber).
// Refresh them at the top of each new session from the prior session's data.

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
    description: 'Category-level pass rates calibrated from 8,824 bills across the 2021-22 and 2023-24 sessions. Tax bills behave differently than transportation bills.',
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

// LIVE from 2025-2026 session outcomes (query run April 2026, N=2,855 bills).
// Each row: final score bucket → actual pass rate.
const CALIBRATION = [
  { bucket: '75–99', label: 'HIGH',      bills: 176,  chamber: 46.0, law: 33.5 },
  { bucket: '60–74', label: 'MODERATE',  bills: 233,  chamber: 11.2, law:  3.9 },
  { bucket: '45–59', label: 'LOW',       bills: 347,  chamber:  6.3, law:  0.0 },
  { bucket: '30–44', label: 'VERY LOW',  bills: 921,  chamber:  1.0, law:  0.0 },
  { bucket: ' 0–29', label: 'VERY LOW',  bills: 1178, chamber:  0.0, law:  0.0 },
]

// Color per confidence tier, matching the bill detail page
const TIER_COLOR = {
  'HIGH':     '#00e5cc',  // teal
  'MODERATE': '#ffc94a',  // gold
  'LOW':      '#ff9f43',  // amber
  'VERY LOW': '#8a96ad',  // muted
}

export default function MethodologyPage() {
  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>

      {/* HEADER */}
      <div style={{
        background: 'rgba(8,12,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 20px 20px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24, fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(0,229,204,0.2)',
        }}>Methodology</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          How Vector | WA scores bills
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

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

        {/* SECTION — SIGNALS */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            The Five Signals
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {SIGNALS.map((s, i) => (
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
                  {s.description}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {s.inputs.map(inp => (
                    <span key={inp} style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      background: 'rgba(0,229,204,0.08)',
                      border: '1px solid rgba(0,229,204,0.25)',
                      borderRadius: 10,
                      color: 'var(--text-muted)',
                    }}>{inp}</span>
                  ))}
                </div>
              </div>
            ))}
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
              that aren't captured by the five base signals. These are the things a seasoned lobbyist
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

        {/* SECTION — CALIBRATION (the proof point) */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            Calibration — 2025-26 Session Outcomes
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              The chart below is the whole point. It shows, for the 2,855 bills in the 2025-26 session,
              what fraction of bills in each score bucket <em>actually</em> became law. If the scoring
              model is any good, higher buckets should pass at meaningfully higher rates — and they do,
              with clean monotonic separation.
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
                    <th style={{ textAlign: 'left',  padding: '10px 16px', fontWeight: 600 }}>Score</th>
                    <th style={{ textAlign: 'left',  padding: '10px 8px',  fontWeight: 600 }}>Tier</th>
                    <th style={{ textAlign: 'right', padding: '10px 8px',  fontWeight: 600 }}>Bills</th>
                    <th style={{ textAlign: 'right', padding: '10px 8px',  fontWeight: 600 }}>Chamber</th>
                    <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600 }}>Law</th>
                  </tr>
                </thead>
                <tbody>
                  {CALIBRATION.map((c, i) => (
                    <tr key={c.bucket} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>{c.bucket}</td>
                      <td style={{ padding: '12px 8px', color: TIER_COLOR[c.label], fontWeight: 600 }}>{c.label}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{c.bills.toLocaleString()}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>{c.chamber.toFixed(1)}%</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: TIER_COLOR[c.label], fontWeight: 600 }}>{c.law.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
              Source: Vector | WA database, session outcomes as of sine die March 12, 2026. N=2,855.
              "Chamber" = passed its chamber of origin. "Law" = signed by the governor.
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
            where a bill is. Vector | WA tells you where a bill is <em>going</em>. The 1,178 bills in
            the 0-29 bucket had a 0% pass rate. The 176 bills in the 75+ bucket had a 33.5% pass rate —
            <span style={{ color: 'var(--teal)', fontWeight: 600 }}> 59 of them became law</span>.
            That 33× separation is the signal you're paying for.
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              Scores refresh nightly. The calibration table above will be re-computed at the end of
              each session against the new outcome data, so the model stays honest.
            </div>
          </div>
        </div>

      </div>

      <Nav />
    </div>
  )
}
