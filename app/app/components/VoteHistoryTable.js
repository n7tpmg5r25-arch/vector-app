'use client'
/**
 * VoteHistoryTable — Vector | WA Thread 11
 *
 * Renders roll_call + member_votes data from Thread 6's vote-data foundation.
 * G5 frozen-engine rule: this component is READ-ONLY display. It does not
 * read from, write to, or influence scoreBill() in any way.
 *
 * Two modes:
 *   - mode="by-bill"   — list of roll_calls on a single bill;
 *                         click a row to expand a member breakdown.
 *   - mode="by-member" — list of roll_calls a single legislator voted on,
 *                         with the bill linked + their vote shown inline.
 *
 * v1 ships WITHOUT party labels. member_votes.party is 100% NULL today
 * (the Thread 6 sync didn't backfill party — pending SponsorService roster
 * cache work in a Thread 11.1 follow-up). Showing partial coverage from
 * bills.prime_sponsor would mislead, so we omit the column for now.
 *
 * Colors:
 *   YEA    → #4ade80 (green; matches members/page.js law-passed accent)
 *   NAY    → #ef4444 (red)
 *   EXCUSED/ABSENT → var(--text-faint)
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { formatSessionDate } from '../../lib/session-config'

const VOTE_COLORS = {
  YEA:     { bg: 'rgba(74,222,128,0.14)',  text: '#4ade80', border: 'rgba(74,222,128,0.30)' },
  NAY:     { bg: 'rgba(239,68,68,0.14)',   text: '#ef4444', border: 'rgba(239,68,68,0.30)'  },
  EXCUSED: { bg: 'var(--bg-surface)',      text: 'var(--text-faint)', border: 'var(--border)' },
  ABSENT:  { bg: 'var(--bg-surface)',      text: 'var(--text-faint)', border: 'var(--border)' },
}

const VOTE_LABEL = { YEA: 'Yea', NAY: 'Nay', EXCUSED: 'Excused', ABSENT: 'Absent' }

function isFinalPassage(motion = '') {
  return /final\s+passage/i.test(motion)
}

/** Convert a roll_call row to a "+/-N" margin string. */
function fmtMargin(rc) {
  const total = (rc.yeas || 0) + (rc.nays || 0)
  if (total === 0) return ''
  const margin = (rc.yeas || 0) - (rc.nays || 0)
  return `${margin > 0 ? '+' : ''}${margin}`
}

/** Date renderer — uses session-config formatSessionDate for app-wide consistency. */
function fmtDate(dateStr) {
  if (!dateStr) return ''
  // formatSessionDate expects YYYY-MM-DD; vote_date is already that shape.
  return formatSessionDate(dateStr)
}

/* ── BY-BILL MODE ─────────────────────────────────────────── */

function ByBillRow({ rc, expanded, onToggle, votes, votesLoading }) {
  const isFinal = isFinalPassage(rc.motion)
  const passed = (rc.result || '').toLowerCase() === 'passed'
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${isFinal ? 'rgba(184,151,90,0.35)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '10px 12px',
      marginBottom: 6,
      boxShadow: isFinal ? '0 0 12px rgba(184,151,90,0.06)' : 'none',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', background: 'none', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left', color: 'inherit',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 9, padding: '2px 7px', borderRadius: 6,
              background: rc.chamber === 'House' ? 'rgba(77,154,255,0.10)' : 'rgba(255,168,77,0.10)',
              color: rc.chamber === 'House' ? '#4d9aff' : '#ffa84d',
              border: `1px solid ${rc.chamber === 'House' ? 'rgba(77,154,255,0.25)' : 'rgba(255,168,77,0.25)'}`,
              fontWeight: 600, letterSpacing: '0.04em',
            }}>{rc.chamber}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {fmtDate(rc.vote_date)}
            </span>
            {isFinal && (
              <span style={{
                fontSize: 8, padding: '2px 6px', borderRadius: 4,
                background: 'rgba(184,151,90,0.10)', color: 'var(--teal)',
                border: '1px solid rgba(184,151,90,0.25)', fontWeight: 600,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>Final Passage</span>
            )}
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.35,
            fontWeight: isFinal ? 600 : 500, marginBottom: 4,
          }}>
            {rc.motion || 'Roll Call'}
          </div>
          <div style={{
            display: 'flex', gap: 12, alignItems: 'center',
            fontSize: 11, fontFamily: 'var(--font-mono)',
          }}>
            <span style={{ color: VOTE_COLORS.YEA.text, fontWeight: 600 }}>{rc.yeas} Y</span>
            <span style={{ color: VOTE_COLORS.NAY.text, fontWeight: 600 }}>{rc.nays} N</span>
            {(rc.excused > 0 || rc.absent > 0) && (
              <span style={{ color: 'var(--text-faint)' }}>
                {rc.excused + rc.absent} {rc.excused + rc.absent === 1 ? 'out' : 'out'}
              </span>
            )}
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span style={{ color: passed ? 'var(--teal)' : 'var(--danger)', fontWeight: 600, textTransform: 'capitalize' }}>
              {rc.result || 'unrecorded'}
            </span>
            <span style={{ color: 'var(--text-faint)', marginLeft: 'auto', fontSize: 10 }}>{fmtMargin(rc)}</span>
          </div>
        </div>
        <span style={{
          color: 'var(--text-faint)', fontSize: 12,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s', flexShrink: 0, marginTop: 2,
        }}>›</span>
      </button>

      {expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: '1px solid var(--border)',
        }}>
          {votesLoading ? (
            <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 11, color: 'var(--text-faint)' }}>
              Loading member breakdown...
            </div>
          ) : votes && votes.length > 0 ? (
            <MemberBreakdown votes={votes} />
          ) : (
            <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 11, color: 'var(--text-faint)' }}>
              No member-level vote records for this roll call.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MemberBreakdown({ votes }) {
  // Group by vote bucket; keep a stable display order.
  const buckets = ['YEA', 'NAY', 'EXCUSED', 'ABSENT']
  const grouped = {}
  for (const b of buckets) grouped[b] = []
  for (const v of votes) {
    const k = (v.vote || '').toUpperCase()
    if (grouped[k]) grouped[k].push(v)
  }
  for (const b of buckets) grouped[b].sort((a, b2) => (a.member_name || '').localeCompare(b2.member_name || ''))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {buckets.map(bucket => {
        const list = grouped[bucket]
        if (list.length === 0) return null
        const colors = VOTE_COLORS[bucket]
        return (
          <div key={bucket}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
            }}>
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 6,
                background: colors.bg, color: colors.text,
                border: `1px solid ${colors.border}`, fontWeight: 600,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{VOTE_LABEL[bucket]}</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                {list.length}
              </span>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 4,
            }}>
              {list.map(v => (
                <span key={v.member_id || v.member_name} style={{
                  fontSize: 11, color: 'var(--text-mid)',
                  padding: '3px 6px', borderRadius: 4,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                }}>{v.member_name}</span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── BY-MEMBER MODE ───────────────────────────────────────── */

function ByMemberRow({ row }) {
  const v = (row.member_vote || '').toUpperCase()
  const colors = VOTE_COLORS[v] || VOTE_COLORS.ABSENT
  const isFinal = isFinalPassage(row.motion)
  return (
    <Link
      href={`/bill/${row.bill_id}`}
      prefetch={false}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 6,
        textDecoration: 'none', color: 'inherit', cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      <span style={{
        fontSize: 10, padding: '4px 8px', borderRadius: 6, minWidth: 56,
        textAlign: 'center', background: colors.bg, color: colors.text,
        border: `1px solid ${colors.border}`, fontWeight: 700,
        letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0,
      }}>{VOTE_LABEL[v] || v || '—'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
          marginBottom: 2, display: 'flex', gap: 6, flexWrap: 'wrap',
        }}>
          <span>{row.bill_label}</span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span>{fmtDate(row.vote_date)}</span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span>{row.chamber}</span>
          {isFinal && (
            <span style={{ color: 'var(--teal)', fontWeight: 600, marginLeft: 4 }}>Final Passage</span>
          )}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.3,
          marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {row.bill_title || row.motion}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
          {row.motion}
          <span style={{ marginLeft: 8 }}>
            {row.yeas}–{row.nays}
            <span style={{ marginLeft: 6, color: (row.result || '').toLowerCase() === 'passed' ? 'var(--teal)' : 'var(--danger)' }}>
              ({row.result || 'unrecorded'})
            </span>
          </span>
        </div>
      </div>
    </Link>
  )
}

/* ── PUBLIC API ───────────────────────────────────────────── */

export default function VoteHistoryTable({ mode, rollCalls, byMemberRows, scopeLabel }) {
  const supabase = createBrowserClient()
  const [expandedId, setExpandedId] = useState(null)
  const [votesById, setVotesById]   = useState({})
  const [loadingId, setLoadingId]   = useState(null)

  // Lazy-load member breakdown for the expanded roll call.
  useEffect(() => {
    if (mode !== 'by-bill') return
    if (!expandedId) return
    if (votesById[expandedId]) return
    let cancelled = false
    setLoadingId(expandedId)
    ;(async () => {
      const { data } = await supabase
        .from('member_votes')
        .select('roll_call_id, member_id, member_name, vote')
        .eq('roll_call_id', expandedId)
      if (cancelled) return
      setVotesById(prev => ({ ...prev, [expandedId]: data || [] }))
      setLoadingId(null)
    })()
    return () => { cancelled = true }
  }, [expandedId, mode, supabase, votesById])

  // ── BY-BILL ──
  if (mode === 'by-bill') {
    if (!rollCalls || rollCalls.length === 0) {
      return (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '16px',
          textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
        }}>
          No roll-call votes recorded for this bill yet.
        </div>
      )
    }

    return (
      <div>
        {scopeLabel && (
          <div style={{
            fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em',
            textTransform: 'uppercase', marginBottom: 8,
          }}>
            Roll-call history · {scopeLabel}
          </div>
        )}
        {rollCalls.map(rc => (
          <ByBillRow
            key={rc.id}
            rc={rc}
            expanded={expandedId === rc.id}
            onToggle={() => setExpandedId(expandedId === rc.id ? null : rc.id)}
            votes={votesById[rc.id]}
            votesLoading={loadingId === rc.id}
          />
        ))}
      </div>
    )
  }

  // ── BY-MEMBER ──
  if (mode === 'by-member') {
    if (!byMemberRows || byMemberRows.length === 0) {
      return (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '16px',
          textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
        }}>
          No recorded floor or committee votes for this legislator yet.
        </div>
      )
    }

    return (
      <div>
        {scopeLabel && (
          <div style={{
            fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em',
            textTransform: 'uppercase', marginBottom: 8,
          }}>
            Voting record · {scopeLabel}
          </div>
        )}
        {byMemberRows.map((row, i) => (
          <ByMemberRow key={`${row.roll_call_id}-${i}`} row={row} />
        ))}
      </div>
    )
  }

  return null
}
