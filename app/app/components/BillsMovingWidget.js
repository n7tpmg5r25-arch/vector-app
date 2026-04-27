'use client'
/**
 * BillsMovingWidget -- Phase 12 Batch 4 + Thread 24 (2026-04-26)
 *
 * Anon-safe widget for the public home. Two branches keyed off
 * isInterimPeriod():
 *
 *   IN-SESSION branch
 *     Top 5 bills by absolute 7-day score delta.
 *
 *   INTERIM branch
 *     Three descriptive panels:
 *       A. Countdown -- when the next session convenes.
 *       B. Sine die snapshot -- stacked bar of LAW / PASSED_CHAMBER / DEAD
 *          for a closed biennium, with toggle across closed sessions
 *          (dynamically derived from getClosedSessions()).
 *       C. Where the bills went -- 4-stage attrition funnel
 *          (Filed -> Committee passed -> Chamber passed -> Signed) plus
 *          top 4 most-active substantive categories with pass rate.
 *
 * Thread 24 fix #3 (2026-04-26): loadInterim refactored from N count
 * queries to a single multi-session row fetch with JS aggregation.
 * Reasons:
 *   - The chained head=true count queries (.eq().eq().eq()) were silently
 *     returning count=0 in the deployed build despite the data being
 *     present (verified via Supabase MCP). Cause unknown but clearly
 *     present in production.
 *   - The categories query without an explicit .limit() was capped at the
 *     Supabase JS 1000-row default, truncating ~3,111 bills to ~1,000 and
 *     producing under-counted category totals.
 * One fetch with .limit(15000) covers all three visible closed sessions
 * (~9,000 rows total across 2025-26 + 2023-24 + 2021-22), payload ~200 KB
 * gzipped to ~50 KB. Still cheaper than the previous panel-C path which
 * paginated bill_committee_referrals up to 20 k rows.
 *
 * G1 -- Closed-session list and label derive from session-config helpers
 *       (getClosedSessions, getMostRecentClosedSession, bienniumShortLabel)
 *       so the panel auto-rolls per biennium without per-cycle code edits.
 * G5 -- No scoreBill / extractFeatures touches; no cohort literal touches.
 *
 * RLS: queries hit `bills` only (anon-readable). No user-scoped data.
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
  bienniumShortLabel,
  getClosedSessions,
  getMostRecentClosedSession,
} from '../../lib/session-config'
import { deltaToEnglish } from '../../lib/score-to-english'
import ScoreBadge from './ScoreBadge'
import { STAGE_SHORT } from '../../lib/stages'

function deltaColor(delta) {
  if (delta > 0) return '#7aab6e'
  if (delta < 0) return '#c47a30'
  return 'var(--text-muted)'
}

export default function BillsMovingWidget() {
  const supabase = useMemo(() => createBrowserClient(), [])
  const interim = isInterimPeriod()

  const [loading, setLoading] = useState(true)
  const [movers, setMovers] = useState([])
  const [snapshots, setSnapshots] = useState({})
  const [funnel, setFunnel] = useState({ filed: 0, committeePassed: 0, chamberPassed: 0, signed: 0 })
  const [topCategories, setTopCategories] = useState([])
  const [visibleClosed, setVisibleClosed] = useState([])
  const [mostRecentClosed, setMostRecentClosed] = useState(null)

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
      const closedAll = getClosedSessions()
      if (closedAll.length === 0) {
        setLoading(false)
        return
      }
      const recent = getMostRecentClosedSession()
      const visible = closedAll.slice(0, 3)

      // PAGINATED multi-session fetch. Supabase JS / PostgREST silently
      // caps responses at a low row count even when .limit(N) is specified
      // (observed: ~500 rows out of 8 k requested in production). Using
      // explicit .range(start, end) pagination instead -- the same pattern
      // the original referrals fetch already used. 1 k rows per page,
      // 12 k cap (well above any biennium size).
      const PAGE = 1000
      const MAX  = 12000
      const rows = []
      let pageError = null
      for (let offset = 0; offset < MAX; offset += PAGE) {
        const { data, error } = await supabase
          .from('bills')
          .select('session, committee_passed, confidence_label, category')
          .in('session', visible)
          .eq('legislation_type', 'bill')
          .range(offset, offset + PAGE - 1)

        if (cancelled) return
        if (error) { pageError = error; break }
        if (!data || data.length === 0) break
        rows.push(...data)
        if (data.length < PAGE) break
      }

      if (pageError) {
        // eslint-disable-next-line no-console
        console.error('BillsMovingWidget interim fetch error:', pageError)
        setLoading(false)
        return
      }

      // Initialize snapshot buckets for every visible closed session, even
      // ones with zero rows (unlikely but defensive).
      const snaps = {}
      visible.forEach((s) => { snaps[s] = { law: 0, passed: 0, dead: 0 } })

      const f = { filed: 0, committeePassed: 0, chamberPassed: 0, signed: 0 }
      const byCat = new Map()

      for (const row of rows) {
        // Panel B -- snapshot across all visible closed sessions
        if (snaps[row.session]) {
          if (row.confidence_label === 'LAW') snaps[row.session].law++
          else if (row.confidence_label === 'PASSED_CHAMBER') snaps[row.session].passed++
          else if (row.confidence_label === 'DEAD') snaps[row.session].dead++
        }

        // Panel C -- funnel + categories only for the most-recent-closed
        if (row.session === recent) {
          f.filed++
          if (row.committee_passed === true) f.committeePassed++
          if (row.confidence_label === 'LAW' || row.confidence_label === 'PASSED_CHAMBER') f.chamberPassed++
          if (row.confidence_label === 'LAW') f.signed++

          if (row.category && row.category !== 'Other') {
            if (!byCat.has(row.category)) byCat.set(row.category, { total: 0, passed: 0 })
            const acc = byCat.get(row.category)
            acc.total++
            if (row.confidence_label === 'LAW') acc.passed++
          }
        }
      }

      const topCats = Array.from(byCat.entries())
        .map(([category, acc]) => ({ category, total: acc.total, passed: acc.passed }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 4)

      setSnapshots(snaps)
      setFunnel(f)
      setTopCategories(topCats)
      setVisibleClosed(visible)
      setMostRecentClosed(recent)
      setLoading(false)
    }

    if (interim) loadInterim()
    else loadInSession()

    return () => { cancelled = true }
  }, [supabase, interim])

  if (loading) {
    return (
      <div style={{
        padding: 24,
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
      }}>
        Loading...
      </div>
    )
  }

  return interim ? (
    <InterimView
      snapshots={snapshots}
      funnel={funnel}
      topCategories={topCategories}
      visibleClosed={visibleClosed}
      mostRecentClosed={mostRecentClosed}
    />
  ) : (
    <InSessionView movers={movers} />
  )
}

// -- In-session view --------------------------------------------------------
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

// -- Interim view -----------------------------------------------------------
function InterimView({ snapshots, funnel, topCategories, visibleClosed, mostRecentClosed }) {
  const next = getNextBiennium()
  const days = daysUntil(next.start)
  const [activeSession, setActiveSession] = useState(mostRecentClosed)
  const stats = snapshots?.[activeSession] || { law: 0, passed: 0, dead: 0 }
  const total = stats.law + stats.passed + stats.dead
  const recentLabel = mostRecentClosed ? bienniumShortLabel(mostRecentClosed) : ''

  return (
    <section style={{ padding: '0 16px' }}>
      <SectionHeader eyebrow="Right now" title="Washington is between sessions" />

      {/* -- Panel A -- Countdown -- */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--teal)',
        borderRadius: 8,
        padding: '16px 18px',
        marginBottom: 12,
        fontFamily: 'var(--font-body)',
      }}>
        <div style={{
          fontSize: 11,
          color: 'var(--teal)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 6,
          fontWeight: 600,
        }}>
          Interim period
        </div>
        <div style={{ fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.55, marginBottom: 8 }}>
          {`The ${next.session.slice(0, 4)}\u2013${next.session.slice(-2)} session begins `}
          <strong style={{ color: 'var(--gold)' }}>{formatSessionDate(next.start)}</strong>
          {`. No bills are actively moving \u2014 the building is dark.`}
        </div>
        {days > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {days} {days === 1 ? 'day' : 'days'} until session
          </div>
        )}
      </div>

      {/* -- Panel B -- Sine die snapshot -- */}
      {total > 0 && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '16px 18px',
          marginBottom: 16,
          fontFamily: 'var(--font-body)',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}>
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              {`Sine die snapshot \u00b7 ${total.toLocaleString()} bills`}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {visibleClosed.map((s) => (
                <SessionToggle
                  key={s}
                  label={bienniumShortLabel(s)}
                  active={s === activeSession}
                  onClick={() => setActiveSession(s)}
                />
              ))}
            </div>
          </div>
          <SineDieBar stats={stats} total={total} />
        </div>
      )}

      {/* -- Panel C -- Funnel + Categories -- */}
      {funnel.filed > 0 && (
        <>
          <SectionHeader
            eyebrow={`From the ${recentLabel} session`}
            title="Where the bills went"
            sublabel="Stage-by-stage attrition"
          />
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            <FunnelStage label="Filed"             count={funnel.filed}           max={funnel.filed} color="var(--text-muted)" />
            <FunnelStage label="Passed committee"  count={funnel.committeePassed} max={funnel.filed} color="var(--gold)" />
            <FunnelStage label="Passed a chamber"  count={funnel.chamberPassed}   max={funnel.filed} color="#c47a30" />
            <FunnelStage label="Signed into law"   count={funnel.signed}          max={funnel.filed} color="#7aab6e" />
          </div>

          {topCategories.length > 0 && (
            <>
              <SectionHeader
                eyebrow="Where they came from"
                title="Most active categories"
                sublabel="By volume, with pass rate"
              />
              <div style={{ display: 'grid', gap: 6 }}>
                {topCategories.map((c) => (
                  <CategoryRow
                    key={c.category}
                    category={c.category}
                    total={c.total}
                    passed={c.passed}
                    max={topCategories[0].total}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

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

function SineDieBar({ stats, total }) {
  const lawPct = total ? (stats.law / total) * 100 : 0
  const passedPct = total ? (stats.passed / total) * 100 : 0
  const deadPct = total ? (stats.dead / total) * 100 : 0

  const LAW_COLOR = '#7aab6e'
  const PASSED_COLOR = '#c47a30'
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
        <SnapshotLegend color={LAW_COLOR}    label="Became law"     count={stats.law}    pct={round(lawPct)} />
        <SnapshotLegend color={PASSED_COLOR} label="Passed chamber" count={stats.passed} pct={round(passedPct)} />
        <SnapshotLegend color={DEAD_COLOR}   label="Died"           count={stats.dead}   pct={round(deadPct)} />
      </div>
    </>
  )
}

function SnapshotLegend({ color, label, count, pct }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
      <span aria-hidden="true" style={{
        width: 8, height: 8, borderRadius: 2,
        background: color, display: 'inline-block', flexShrink: 0,
      }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 14, color: 'var(--text-primary)', fontWeight: 700,
          fontFamily: 'var(--font-body)',
        }}>
          {count.toLocaleString()}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {`${label} \u00b7 ${pct}%`}
        </span>
      </div>
    </div>
  )
}

function FunnelStage({ label, count, max, color }) {
  const width = max ? Math.max(2, (count / max) * 100) : 0
  const pct = max ? Math.round((count / max) * 100) : 0
  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
          {label}
        </span>
        <span style={{
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          flexShrink: 0,
          color: color,
        }}>
          {count.toLocaleString()}
          <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
            {`\u00b7 ${pct}%`}
          </span>
        </span>
      </div>
      <div aria-hidden="true" style={{
        height: 3,
        background: 'var(--border)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{ width: `${width}%`, height: '100%', background: color }} />
      </div>
    </div>
  )
}

function CategoryRow({ category, total, passed, max }) {
  const width = max ? Math.max(2, (total / max) * 100) : 0
  const passRate = total ? Math.round((passed / total) * 100) : 0
  const rateColor = passRate >= 30 ? '#7aab6e' : passRate >= 15 ? '#c47a30' : 'var(--text-muted)'
  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 4,
      }}>
        <span style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}>
          {category}
        </span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{total.toLocaleString()}</span>
          <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>{'\u00b7'}</span>
          <span style={{ color: rateColor, fontWeight: 500 }}>
            {passRate}% passed
          </span>
        </span>
      </div>
      <div aria-hidden="true" style={{
        height: 3,
        background: 'var(--border)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{ width: `${width}%`, height: '100%', background: 'var(--teal)' }} />
      </div>
    </div>
  )
}

function SectionHeader({ eyebrow, title, sublabel }) {
  return (
    <div style={{ marginBottom: 12, fontFamily: 'var(--font-body)' }}>
      {eyebrow && (
        <div style={{
          fontSize: 10,
          color: 'var(--teal)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 4,
          fontWeight: 600,
        }}>
          {eyebrow}
        </div>
      )}
      <div style={{
        fontSize: 18,
        color: 'var(--text-primary)',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        lineHeight: 1.2,
      }}>
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
        <div style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          fontWeight: 600,
          letterSpacing: '0.02em',
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
            {bill.bill_number}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>
            {STAGE_SHORT[bill.stage] || 'Intro'}
          </span>
        </div>
        <div style={{
          fontSize: 12,
          color: 'var(--text-mid)',
          marginTop: 3,
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {bill.title}
        </div>
        {typeof delta === 'number' && (
          <div style={{
            fontSize: 11,
            color: deltaColor(delta),
            marginTop: 5,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}>
            {deltaToEnglish(delta)}
            {delta !== 0 && (
              <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>
                {delta > 0 ? '+' : ''}{delta.toFixed(1)} pts {'\u00b7'} 7 days
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
    <div style={{
      padding: '20px 18px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontFamily: 'var(--font-body)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}>
        {headline}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{body}</div>
    </div>
  )
}