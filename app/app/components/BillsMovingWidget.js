'use client'
/**
 * BillsMovingWidget — Phase 12 Batch 4
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
 *     Three-card stack:
 *       (1) Explainer card — "Session begins Jan 11, 2027. The building is dark."
 *       (2) Session recap card — counts of LAW / CARRY OVER / DEAD for the
 *           most recent completed session, link to /outcomes.
 *       (3) Notable bills row — top 5 by final_score from the last completed
 *           session, labeled with confidence_label so framing is honest
 *           (these are outcomes, not predictions).
 *
 * Voice per v4.6 §14: actionable signal, plain English, no "we predict X%".
 *
 * RLS: queries hit `bills` and `trajectory_snapshots`, both anon-readable
 * per RLS_AUDIT_2026-04.md (Phase 12 Batch 2 verified). No user-scoped data.
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

export default function BillsMovingWidget() {
  const supabase = useMemo(() => createBrowserClient(), [])
  const interim = isInterimPeriod()

  const [loading, setLoading] = useState(true)
  const [movers, setMovers] = useState([]) // in-session: [{ bill, delta }]
  const [recap, setRecap] = useState({ session: null, law: 0, carry: 0, dead: 0 })
  const [notable, setNotable] = useState([]) // interim: top scored bills

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
      // Find the most recent session that has bills with terminal labels.
      // Default to the just-finished biennium per session-config.
      const SESSION = getCurrentSession()

      const [lawRes, carryRes, deadRes, notableRes] = await Promise.all([
        supabase
          .from('bills')
          .select('bill_id', { count: 'exact', head: true })
          .eq('session', SESSION)
          .eq('legislation_type', 'bill')
          .eq('confidence_label', 'LAW'),
        supabase
          .from('bills')
          .select('bill_id', { count: 'exact', head: true })
          .eq('session', SESSION)
          .eq('legislation_type', 'bill')
          .eq('confidence_label', 'PASSED_CHAMBER'),
        supabase
          .from('bills')
          .select('bill_id', { count: 'exact', head: true })
          .eq('session', SESSION)
          .eq('legislation_type', 'bill')
          .eq('confidence_label', 'DEAD'),
        supabase
          .from('bills')
          .select(
            'bill_id, bill_number, title, final_score, stage, chamber, committee_name, confidence_label'
          )
          .eq('session', SESSION)
          .eq('legislation_type', 'bill')
          .not('final_score', 'is', null)
          .order('final_score', { ascending: false })
          .limit(5),
      ])

      if (cancelled) return

      setRecap({
        session: SESSION,
        law: lawRes.count || 0,
        carry: carryRes.count || 0,
        dead: deadRes.count || 0,
      })
      setNotable(notableRes.data || [])
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
    <InterimView recap={recap} notable={notable} />
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
function InterimView({ recap, notable }) {
  const next = getNextBiennium()
  const days = daysUntil(next.start)

  return (
    <section style={{ padding: '0 16px' }}>
      <SectionHeader eyebrow="Right now" title="Washington is between sessions" />

      {/* Card 1 — Interim explainer */}
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

      {/* Card 2 — Session recap */}
      {recap.session && (recap.law + recap.carry + recap.dead > 0) && (
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
              fontSize: 11,
              color: 'var(--text-muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 10,
              fontWeight: 600,
            }}
          >
            {recap.session} session — final tally
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <RecapStat label="Became law" value={recap.law} color="#7aab6e" />
            <RecapStat label="Passed chamber" value={recap.carry} color="#c47a30" />
            <RecapStat label="Died" value={recap.dead} color="var(--text-muted)" />
          </div>
        </div>
      )}

      {/* Card 3 — Notable bills */}
      {notable.length > 0 && (
        <>
          <SectionHeader
            eyebrow={`From the ${recap.session || 'last'} session`}
            title="Notable bills"
            sublabel="Highest scored on the trajectory model"
          />
          <div style={{ display: 'grid', gap: 10 }}>
            {notable.map((bill) => (
              <BillCard key={bill.bill_id} bill={bill} />
            ))}
          </div>
        </>
      )}
    </section>
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

function RecapStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 22, color, fontWeight: 700, fontFamily: 'var(--font-body)' }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', marginTop: 2 }}>
        {label}
      </div>
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
