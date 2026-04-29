'use client'
/**
 * VoteSplitBar — Vector | WA Thread 18 (2026-04-26),
 *                Thread 21 readability polish (2026-04-26).
 *
 * Replaces the broken `bills.avg_floor_margin` Floor Vote card on the
 * bill detail Votes tab. Computes the floor margin live from
 * roll_calls + member_votes (data the page already has access to)
 * because `bills.avg_floor_margin` has been NULL on all 8,817 rows
 * since the Thread 6 Vote Data Foundation ship — pre-existing
 * extractFeatures() XML-shape bug, intentionally G5-frozen until
 * the post-2027-session calibration refresh.
 *
 * Renders one stacked horizontal bar per chamber that has a Final
 * Passage roll call (Senate above House per WA convention). Yes side
 * is green-tinted, No side is red-tinted; individual member votes
 * tile across as 1-unit blocks colored by party (D = Vector blue,
 * R = Vector red).
 *
 * Thread 21 layout (2026-04-26): the original single-row header packed
 * chamber chip + date + tally + verdict, which broke at 480px (chamber
 * chip wrapped onto its own line whenever the verdict was long).
 * Restructure:
 *   Row 1 (header):    chamber chip + date — identifies WHICH vote
 *   Bar
 *   Row 2 (headline):  big bold tally + Passed/Failed (left), verdict
 *                      chip (right) — the "what happened" lane
 *   Row 3 (detail):    smaller, dimmer partisan breakdown — the
 *                      "who voted how" lane, secondary by design
 * The verdict-vocabulary tighten in vote-helpers.characterize() keeps
 * every verdict ≤14 chars so Row 2 never wraps awkwardly.
 *
 * G5 frozen-engine: read-only display. Never imports or calls
 * scoreBill() / extractFeatures().
 *
 * Props:
 *   rollCalls    — array of roll_call rows for the bill (parent has
 *                  these in state already; we filter internally for
 *                  Final Passage motions per chamber).
 *   partyBuckets — optional map of roll_call_id → buckets object
 *                  (yesD/yesR/yesU/noD/noR/noU). When provided, skips
 *                  the per-roll-call member_votes fetch. Parent page
 *                  pre-fetches once for the whole bill so VoteSplitBar
 *                  + LatestFloorVoteStrip + roll-call history rows
 *                  can share the same data.
 */
import { useEffect, useMemo, useState } from 'react'
import { Vote } from 'lucide-react'
import { createBrowserClient } from '../../lib/supabase'
import { formatSessionDate } from '../../lib/session-config'
import {
  isFinalPassage, bucketMemberVotes, padBucketsToReported, characterize,
} from '../../lib/vote-helpers'

function SingleVoteSplitBar({ rc, buckets }) {
  const passed = (rc.result || '').toLowerCase() === 'passed'
  const total = buckets.yesD + buckets.yesR + buckets.yesU
              + buckets.noD  + buckets.noR  + buckets.noU
  if (total === 0) return null

  const totalYes = buckets.yesD + buckets.yesR + buckets.yesU
  const totalNo  = buckets.noD  + buckets.noR  + buckets.noU

  const W = 300, H = 22
  const px = n => (n / total) * W
  const yesW = px(totalYes)

  const colorFor = p =>
    p === 'D' ? '#4d9aff'
    : p === 'R' ? '#ef4444'
    : 'rgba(255,255,255,0.20)'

  const yesBlocks = [
    ...Array(buckets.yesD).fill('D'),
    ...Array(buckets.yesR).fill('R'),
    ...Array(buckets.yesU).fill('U'),
  ]
  const noBlocks = [
    ...Array(buckets.noR).fill('R'),
    ...Array(buckets.noD).fill('D'),
    ...Array(buckets.noU).fill('U'),
  ]

  const verdict = characterize(buckets)
  const chamberAccent = rc.chamber === 'House' ? '#4d9aff' : '#ffa84d'

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 8,
    }}>
      {/* Row 1 — Header: chamber chip + date (tally moved below the bar) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 9, padding: '2px 8px', borderRadius: 6,
          background: rc.chamber === 'House' ? 'rgba(77,154,255,0.10)' : 'rgba(255,168,77,0.10)',
          color: chamberAccent,
          border: `1px solid ${rc.chamber === 'House' ? 'rgba(77,154,255,0.25)' : 'rgba(255,168,77,0.25)'}`,
          fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          {rc.chamber} Final Passage
        </span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
          {formatSessionDate(rc.vote_date)}
        </span>
      </div>

      {/* Stacked bar */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        width="100%" height={H}
        style={{ display: 'block', borderRadius: 4, overflow: 'hidden' }}
        role="img"
        aria-label={
          `${rc.chamber} final passage: ${totalYes} yea (${buckets.yesD} D, ${buckets.yesR} R), ` +
          `${totalNo} nay (${buckets.noD} D, ${buckets.noR} R)`
        }
      >
        <rect x="0"    y="0" width={yesW}     height={H} fill="rgba(74,222,128,0.10)"/>
        <rect x={yesW} y="0" width={W - yesW} height={H} fill="rgba(239,68,68,0.10)"/>
        {yesBlocks.map((p, i) => (
          <rect key={`y-${i}`}
            x={px(i)} y="3" width={Math.max(1, px(1) - 0.5)} height={H - 6}
            fill={colorFor(p)} opacity="0.88"/>
        ))}
        {noBlocks.map((p, i) => (
          <rect key={`n-${i}`}
            x={yesW + px(i)} y="3" width={Math.max(1, px(1) - 0.5)} height={H - 6}
            fill={colorFor(p)} opacity="0.88"/>
        ))}
        {totalYes > 0 && totalNo > 0 && (
          <line x1={yesW} y1="0" x2={yesW} y2={H}
            stroke="rgba(255,255,255,0.22)" strokeWidth="1"/>
        )}
      </svg>

      {/* Row 2 — Headline: big tally + Passed/Failed (left), verdict chip (right) */}
      <div style={{
        marginTop: 10, display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: passed ? 'var(--teal)' : 'var(--danger)',
          letterSpacing: '0.01em', whiteSpace: 'nowrap',
        }}>
          {totalYes}Y / {totalNo}N
          <span style={{ color: 'var(--text-faint)', fontWeight: 500, margin: '0 6px' }}>·</span>
          <span style={{ fontSize: 12 }}>{passed ? 'Passed' : 'Failed'}</span>
        </span>
        {verdict && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 6,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontWeight: 600,
            letterSpacing: '0.02em', whiteSpace: 'nowrap',
          }}>
            {verdict}
          </span>
        )}
      </div>

      {/* Row 3 — Partisan detail (smaller + dimmer than the headline) */}
      <div style={{
        marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)',
        color: 'var(--text-faint)',
      }}>
        {buckets.yesD > 0 && <span style={{ color: '#4d9aff', fontWeight: 600 }}>{buckets.yesD}D</span>}
        {buckets.yesD > 0 && buckets.yesR > 0 && <span> · </span>}
        {buckets.yesR > 0 && <span style={{ color: '#ef4444', fontWeight: 600 }}>{buckets.yesR}R</span>}
        {buckets.yesU > 0 && <span style={{ marginLeft: 4 }}>· {buckets.yesU}?</span>}
        <span style={{ marginLeft: 6 }}>Yes</span>
        <span style={{ margin: '0 8px' }}>/</span>
        {buckets.noD > 0 && <span style={{ color: '#4d9aff', fontWeight: 600 }}>{buckets.noD}D</span>}
        {buckets.noD > 0 && buckets.noR > 0 && <span> · </span>}
        {buckets.noR > 0 && <span style={{ color: '#ef4444', fontWeight: 600 }}>{buckets.noR}R</span>}
        {buckets.noU > 0 && <span style={{ marginLeft: 4 }}>· {buckets.noU}?</span>}
        <span style={{ marginLeft: 6 }}>No</span>
      </div>
    </div>
  )
}

export default function VoteSplitBar({ rollCalls, partyBuckets }) {
  // Filter for the most-recent Final Passage roll call per chamber.
  // Senate is rendered above House (post-floor pairs read top-down).
  const finalPassages = useMemo(() => {
    const byChamber = {}
    for (const rc of (rollCalls || [])) {
      if (!isFinalPassage(rc.motion || '')) continue
      const ch = rc.chamber
      const cur = byChamber[ch]
      if (!cur || (rc.vote_date || '') > (cur.vote_date || '')) byChamber[ch] = rc
    }
    return [byChamber.Senate, byChamber.House].filter(Boolean)
  }, [rollCalls])

  // If parent didn't pre-fetch member_votes, do it ourselves. The parent
  // typically does pre-fetch (so VoteSplitBar, LatestFloorVoteStrip, and
  // roll-call history rows all share one DB call), but the component is
  // designed to work standalone too.
  const [fetchedBuckets, setFetchedBuckets] = useState(null)
  const needFetch = !partyBuckets || finalPassages.some(rc => !partyBuckets[rc.id])

  useEffect(() => {
    if (!needFetch || finalPassages.length === 0) return
    let cancelled = false
    const supabase = createBrowserClient()
    ;(async () => {
      try {
        const ids = finalPassages.map(rc => rc.id)
        const { data } = await supabase
          .from('member_votes')
          .select('roll_call_id, party, vote')
          .in('roll_call_id', ids)
        if (cancelled) return
        const grouped = {}
        for (const v of (data || [])) {
          ;(grouped[v.roll_call_id] = grouped[v.roll_call_id] || []).push(v)
        }
        const out = {}
        for (const rc of finalPassages) {
          const b = bucketMemberVotes(grouped[rc.id] || [])
          out[rc.id] = padBucketsToReported(b, rc)
        }
        setFetchedBuckets(out)
      } catch (err) {
        console.warn('VoteSplitBar member_votes fetch failed', err)
        if (!cancelled) setFetchedBuckets({})
      }
    })()
    return () => { cancelled = true }
  }, [finalPassages, needFetch])

  if (finalPassages.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '20px 16px', textAlign: 'center',
      }}>
        <div style={{ display: 'inline-flex', marginBottom: 8, color: 'var(--text-faint)', opacity: 0.6 }}>
          <Vote size={26} aria-hidden="true" strokeWidth={1.5} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
          No floor vote yet
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          Bill hasn&rsquo;t reached the floor of either chamber.
        </div>
      </div>
    )
  }

  const buckets = needFetch ? (fetchedBuckets || {}) : partyBuckets

  if (needFetch && fetchedBuckets === null) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '14px 16px',
        fontSize: 12, color: 'var(--text-faint)', textAlign: 'center',
      }}>
        Loading floor vote breakdown&hellip;
      </div>
    )
  }

  return (
    <div>
      {finalPassages.map(rc => (
        <SingleVoteSplitBar key={rc.id} rc={rc} buckets={buckets[rc.id] || {
          yesD: 0, yesR: 0, yesU: rc.yeas || 0,
          noD: 0,  noR: 0,  noU: rc.nays || 0,
        }}/>
      ))}
    </div>
  )
}
