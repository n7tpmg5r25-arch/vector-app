'use client'
/**
 * BillsMovingWidget — Phase 12 Batch 4 (Branch 2 rewrite 2026-04-23)
 *
 * Anon-safe widget for the public home. Surfaces what's actually happening
 * with bills in Washington right now.
 *
 * Two branches keyed off isInterimPeriod():
 *
 *   IN-SESSION branch
 *     Top 5 bills by absolute 7-day score delta. Mirrors the algorithm the
 *     owner home uses at app/app/page.js:132-153 — pulls the latest two
 *     trajectory_snapshots per bill, deltas them, sorts.
 *
 *   INTERIM branch (today, 2026-04-21 → 2027-01-11)
 *     Three descriptive panels (no featured-bill editorial surface):
 *       A. Countdown — when does the next session convene.
 *       B. Sine die snapshot — stacked bar of LAW / PASSED_CHAMBER / DEAD
 *          for a closed biennium, with toggle across the three most recent
 *          completed sessions (2025-2026, 2023-2024, 2021-2022). Shows the
 *          legislative funnel shape, not "hot bills".
 *       C. Committee throughput — top 8 committees by distinct bills
 *          referred in the most recent closed session, via the Phase 11.8
 *          `bill_committee_referrals` capture. Descriptive system view.
 *
 * Voice per v4.6 §14: actionable signal, plain English, no editorial
 * featuring of individual bills during interim. Anon visitors see shape
 * and system, not a curated list.
 *
 * RLS: queries hit `bills` and `bill_committee_referrals`, both
 * anon-readable per RLS_AUDIT_2026-04.md (Phase 12 Batch 2 verified).
 * No user-scoped data.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import {
  getCurrentSession,
  getNextBiennium,
  daysUntil,
  isInterimPeriod,
  formatSessionDate,
} from '../../lib/session-config'
import { deltaToEnglish } from '../../lib/score-to-english'
import ScoreBadge from './ScoreBadge'

import { STAGE_SHORT } from '../../lib/stages'
function deltaColor(delta) {
  if (delta > 0) return '#7aab6e' // Sage — gaining
  if (delta < 0) return '#c47a30' // Amber — losing
  return 'var(--text-muted)'
}

// Three most recent closed biennia — used by the interim sine-die snapshot
// toggle. Keep in sync with session-config.js BIENNIUMS + HISTORICAL_SESSIONS.
const CLOSED_SESSIONS = ['2025-2026', '2023-2024', '2021-2022']

export default function BillsMovingWidget() {
  const supabase = useMemo(() => createBrowserClient(), [])
  const interim = isInterimPeriod()

  const [loading, setLoading] = useState(true)
  const [movers, setMovers] = useState([]) // in-session: [{ bill, delta }]
  // Interim: keyed by session, e.g. snapshots['2025-2026'] = { law, passed, dead }
  const [snapshots, setSnapshots] = useState({})
  // Interim: top-8 busiest committees in the most recent closed session
  const [committees, setCommittees] = useState([]) // [{ name, count }]

  useEffect(() => {
    let cancelled = false

    async function loadInSession() {
      const SESSION = getCurrentSession()
      const { data: bills } = await supabase
        .from('bills')
        .select(
          'bill_id, bill_number, title, final_score, stage, chamber, committee_name, confidence_label'
        )
        .eq('session', SESSION)
        .eq('legislation_type', 'bill')
        .not('final_score', 'is', null)
        .eq('stalled', false)
        .lt('stage', 6)
        .order('final_score', { ascending: false })
        .limit(40)

      if (cancelled || !bills?.length) {
        if (!cancelled) setLoading(false)
        return
      }

      const ids = bills.map((b) => b.bill_id)
      const { data: snaps } = await supabase
        .from('trajectory_snapshots')
        .select('bill_id, score, snapshot_date')
        .in('bill_id', ids)
        .order('snapshot_date', { ascending: false })

      if (cancelled) return

      // Same delta algorithm as app/app/page.js:139-149 — last two snapshots
      // per bill, subtract.
      const byBill = {}
      ;(snaps || []).forEach((s) => {
        if (!byBill[s.bill_id]) byBill[s.bill_id] = []
        if (byBill[s.bill_id].length < 2) byBill[s.bill_id].push(s)
      })
      const withDelta = bills
        .map((b) => {
          const arr = byBill[b.bill_id]
          if (!arr || arr.length < 2) return null
          const delta = (arr[0].score || 0) - (arr[1].score || 0)
          return { bill: b, delta }
        })
        .filter(Boolean)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5)

      setMovers(withDelta)
      setLoading(false)
    }

    async function loadInterim() {
      // ── Panel B data: sine die snapshots across 3 closed biennia ──
      // One head-count query per (session × label) — fast, no payload.
      const labels = ['LAW', 'PASSED_CHAMBER', 'DEAD']
      const countQueries = CLOSED_SESSIONS.flatMap((session) =>
        labels.map((label) =>
          supabase
            .from('bills')
            .select('bill_id', { count: 'exact', head: true })
            .eq('session', session)
            .eq('legislation_type', 'bill')
            .eq('confidence_label', label)
        )
      )

      // ── Panel C data: committee throughput for most recent closed session ──
      // Paginate `bill_committee_referrals` since a full biennium can exceed
      // the 1000-row default. Select only (committee_name, bill_id); we dedupe
      // client-side for distinct-bill counts per committee.
      const DEFAULT_SESSION = CLOSED_SESSIONS[0]
      const referralRows = []
      const PAGE = 1000
      for (let offset = 0; offset < 20000; offset += PAGE) {
        const { data, error } = await supabase
          .from('bill_committee_referrals')
          .select('committee_name, bill_id')
          .eq('session', DEFAULT_SESSION)
          .range(offset, offset + PAGE - 1)
        if (cancelled) return
        if (error || !data || data.length === 0) break
        referralRows.push(...data)
        if (data.length < PAGE) break
      }

      const countResults = await Promise.all(countQueries)
      if (cancelled) return

      // Assemble snapshots: { '2025-2026': { law, passed, dead }, ... }
      const snaps = {}
      CLOSED_SESSIONS.forEach((session, si) => {
        snaps[session] = {
          law: countResults[si * 3].count || 0,
          passed: countResults[si * 3 + 1].count || 0,
          dead: countResults[si * 3 + 2].count || 0,
        }
      })

      // Committee throughput: unique bill_id per committee_name, top 8 desc.
      const byCommittee = new Map()
      for (const r of referralRows) {
        if (!r.committee_name || !r.bill_id) continue
        let set = byCommittee.get(r.committee_name)
        if (!set) {
          set = new Set()
          byCommittee.set(r.committee_name, set)
        }
        set.add(r.bill_id)
      }
      const topCommittees = Array.from(byCommittee.entries())
        .map(([name, set]) => ({ name, count: set.size }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)

      setSnapshots(snaps)
      setCommittees(topCommittees)
      setLoading(false)
    }

    if (interim) loadInterim()
    else loadInSession()

    return () => {
      cancelled = true
    }
  }, [supabase, interim])

  if (loading) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    )
  }

  return interim ? (
    <InterimView snapshots={snapshots} committees={committees} />
  ) : (
    <InSessionView movers={movers} />
  )
}

// ─── In-session view ──────────────────────────────────────────────────────
function InSessionView({ movers }) {
  if (!movers.length) {
    return (
      <EmptyCard
        headline="No movement this week"
        body="No bills have shifted enough on the trajectory model to flag here. Check back tomorrow after the nightly sync."
      />
    )
  }
  return (
    <section style={{ padding: '0 16px' }}>
      <SectionHeader
        eyebrow="This week"
        title="Bills moving in Olympia"
        sublabel="Sorted by 7-day trajectory shift"
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {movers.map(({ bill, delta }) => (
          <BillCard key={bill.bill_id} bill={bill} delta={delta} />
        ))}
      </div>
    </section>
  )
}

// ─── Interim view ─────────────────────────────────────────────────────────
// Three descriptive panels — no individual bills featured during interim.
//   A. Countdown to next session.
//   B. Sine die snapshot — stacked bar across 3 closed biennia.
//   C. Committee throughput — top 8 by distinct bills referred.
function InterimView({ snapshots, committees }) {
  const next = getNextBiennium()
  const days = daysUntil(next.start)
  const [activeSession, setActiveSession] = useState(CLOSED_SESSIONS[0])
  const stats = snapshots?.[activeSession] || { law: 0, passed: 0, dead: 0 }
  const total = stats.law + stats.passed + stats.dead

  return (
    <section style={{ padding: '0 16px' }}>
      <SectionHeader eyebrow="Right now" title="Washington is between sessions" />

      {/* ── Panel A — Countdown ── */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--teal)',
          borderRadius: 8,
          padding: '16px 18px',
          marginBottom: 12,
          fontFamily: 'var(--font-body)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--teal)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          Interim period
        </div>
        <div style={{ fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.55, marginBottom: 8 }}>
          The {next.session.slice(0, 4)}–{next.session.slice(-2)} session begins{' '}
          <strong style={{ color: 'var(--gold)' }}>{formatSessionDate(next.start)}</strong>. No bills are
          actively moving — the building is dark.
        </div>
        {days > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {days} {days === 1 ? 'day' : 'days'} until session
          </div>
        )}
      </div>

      {/* ── Panel B — Sine die snapshot (stacked bar + 3-biennium toggle) ── */}
      {total > 0 && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 18px',
            marginBottom: 16,
            fontFamily: 'var(--font-body)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              Sine die snapshot · {total.toLocaleString()} bills
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {CLOSED_SESSIONS.map((s) => (
                <SessionToggle
                  key={s}
                  label={s}
                  active={s === activeSession}
                  onClick={() => setActiveSession(s)}
                />
              ))}
            </div>
          </div>
          <SineDieBar stats={stats} total={total} />
        </div>
      )}

      {/* ── Panel C — Committee throughput ── */}
      {committees.length > 0 && (
        <>
          <SectionHeader
            eyebrow={`From the ${CLOSED_SESSIONS[0]} session`}
            title="Busiest committees"
            sublabel="Distinct bills referred — top 8"
          />
          <div style={{ display: 'grid', gap: 6 }}>
            {committees.map((c) => (
              <CommitteeRow
                key={c.name}
                name={c.name}
                count={c.count}
                max={committees[0].count}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// Pill button used to toggle which closed biennium Panel B displays.
function SessionToggle({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        padding: '4px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        border: active ? '1px solid var(--teal)' : '1px solid var(--border)',
        background: active ? 'var(--bg-card-2)' : 'transparent',
        color: active ? 'var(--teal)' : 'var(--text-muted)',
        transition: 'color 0.15s, border-color 0.15s, background 0.15s',
      }}
    >
      {label}
    </button>
  )
}

// Horizontal stacked bar: LAW / PASSED_CHAMBER / DEAD. Sage / amber / muted.
// Labels below give the raw count + percentage for each segment. Any segment
// narrower than a legibility threshold just collapses to zero width; the
// label row still reports the count.
function SineDieBar({ stats, total }) {
  const lawPct = total ? (stats.law / total) * 100 : 0
  const passedPct = total ? (stats.passed / total) * 100 : 0
  const deadPct = total ? (stats.dead / total) * 100 : 0

  const LAW_COLOR = '#7aab6e' // Sage
  const PASSED_COLOR = '#c47a30' // Amber
  const DEAD_COLOR = 'var(--text-faint)'

  const round = (n) => (n >= 0.5 && n < 1 ? 1 : Math.round(n))

  return (
    <>
      <div
        role="img"
        aria-label={`${stats.law} became law, ${stats.passed} passed chamber, ${stats.dead} died`}
        style={{
          display: 'flex',
          width: '100%',
          height: 14,
          borderRadius: 3,
          overflow: 'hidden',
          background: 'var(--border)',
          marginBottom: 12,
        }}
      >
        {lawPct > 0 && <div style={{ width: `${lawPct}%`, background: LAW_COLOR }} />}
        {passedPct > 0 && <div style={{ width: `${passedPct}%`, background: PASSED_COLOR }} />}
        {deadPct > 0 && <div style={{ width: `${deadPct}%`, background: DEAD_COLOR }} />}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <SnapshotLegend
          color={LAW_COLOR}
          label="Became law"
          count={stats.law}
          pct={round(lawPct)}
        />
        <SnapshotLegend
          color={PASSED_COLOR}
          label="Passed chamber"
          count={stats.passed}
          pct={round(passedPct)}
        />
        <SnapshotLegend
          color={DEAD_COLOR}
          label="Died"
          count={stats.dead}
          pct={round(deadPct)}
        />
      </div>
    </>
  )
}

function SnapshotLegend({ color, label, count, pct }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: 14,
            color: 'var(--text-primary)',
            fontWeight: 700,
            fontFamily: 'var(--font-body)',
          }}
        >
          {count.toLocaleString()}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {label} · {pct}%
        </span>
      </div>
    </div>
  )
}

// One committee row in Panel C — name, distinct-bill count, and a thin
// proportional bar that compares it to the #1 committee in the list.
function CommitteeRow({ name, count, max }) {
  const width = max ? Math.max(2, (count / max) * 100) : 0
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontFamily: 'var(--font-body)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: 'var(--text-primary)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--gold)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {count.toLocaleString()}
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          height: 3,
          background: 'var(--border)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${width}%`, height: '100%', background: 'var(--teal)' }} />
      </div>
    </div>
  )
}

// ─── Shared bits ──────────────────────────────────────────────────────────
function SectionHeader({ eyebrow, title, sublabel }) {
  return (
    <div style={{ marginBottom: 12, fontFamily: 'var(--font-body)' }}>
      {eyebrow && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--teal)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </div>
      )}
      <div
        style={{
          fontSize: 18,
          color: 'var(--text-primary)',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          lineHeight: 1.2,
        }}
      >
        {title}
      </div>
      {sublabel && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sublabel}</div>
      )}
    </div>
  )
}

function BillCard({ bill, delta }) {
  return (
    <Link
      href={`/bill/${bill.bill_id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        textDecoration: 'none',
        fontFamily: 'var(--font-body)',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-light)'
        e.currentTarget.style.background = 'var(--bg-card-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-card)'
      }}
    >
      <ScoreBadge score={bill.final_score} size="sm" status={bill.confidence_label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-primary)',
            fontWeight: 600,
            letterSpacing: '0.02em',
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
            {bill.bill_number}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>
            {STAGE_SHORT[bill.stage] || 'Intro'}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-mid)',
            marginTop: 3,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {bill.title}
        </div>
        {typeof delta === 'number' && (
          <div
            style={{
              fontSize: 11,
              color: deltaColor(delta),
              marginTop: 5,
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            {deltaToEnglish(delta)}
            {delta !== 0 && (
              <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>
                {delta > 0 ? '+' : ''}
                {delta.toFixed(1)} pts · 7 days
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

function EmptyCard({ headline, body }) {
  return (
    <div
      style={{
        padding: '20px 18px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontFamily: 'var(--font-body)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}>
        {headline}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{body}</div>
    </div>
  )
}
