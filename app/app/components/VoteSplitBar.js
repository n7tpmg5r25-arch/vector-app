'use client'
/**
 * VoteSplitBar — Vector | WA Thread 18 (2026-04-26)
 *
 * Replaces the broken bills.avg_floor_margin Floor Vote card on the bill
 * detail Votes tab. Computes the floor margin live from roll_calls +
 * member_votes the page already has access to, working around the
 * pre-existing extractFeatures() XML-shape bug (G5-frozen).
 *
 * Renders one stacked bar per chamber that has a Final Passage roll call
 * (Senate above House per WA convention). Yes side green-tinted, No side
 * red-tinted; individual member votes tile across as 1-unit blocks
 * colored by party. Numeric tally + verdict ("Bipartisan", "Party-line",
 * etc.) sit above and below the bar so the pattern is scannable.
 *
 * G5 frozen-engine: read-only display.
 */
import { useEffect, useMemo, useState } from 'react'
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
        }}>
          {rc.chamber} Final Passage
        </span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
          {formatSessionDate(rc.vote_date)}
        </span>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: passed ? 'var(--teal)' : 'var(--danger)',
          fontWeight: 600, marginLeft: 'auto',
        }}>
          {totalYes}Y / {totalNo}N · {passed ? 'Passed' : 'Failed'}
        </span>
      </div>

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

      <div style={{
        marginTop: 8, display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-mid)' }}>
          {buckets.yesD > 0 && <span style={{ color: '#4d9aff', fontWeight: 600 }}>{buckets.yesD}D</span>}
          {buckets.yesD > 0 && buckets.yesR > 0 && <span style={{ color: 'var(--text-faint)' }}> · </span>}
          {buckets.yesR > 0 && <span style={{ color: '#ef4444', fontWeight: 600 }}>{buckets.yesR}R</span>}
          {buckets.yesU > 0 && <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>· {buckets.yesU}?</span>}
          <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Yes</span>
          <span style={{ color: 'var(--text-faint)', margin: '0 8px' }}>/</span>
          {buckets.noD > 0 && <span style={{ color: '#4d9aff', fontWeight: 600 }}>{buckets.noD}D</span>}
          {buckets.noD > 0 && buckets.noR > 0 && <span style={{ color: 'var(--text-faint)' }}> · </span>}
          {buckets.noR > 0 && <span style={{ color: '#ef4444', fontWeight: 600 }}>{buckets.noR}R</span>}
          {buckets.noU > 0 && <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>· {buckets.noU}?</span>}
          <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>No</span>
        </span>
        {verdict && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {verdict}
          </span>
        )}
      </div>
    </div>
  )
}

export default function VoteSplitBar({ rollCalls, partyBuckets }) {
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
        <div style={{ fontSize: 26, marginBottom: 8, opacity: 0.5 }}>🗳️</div>
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