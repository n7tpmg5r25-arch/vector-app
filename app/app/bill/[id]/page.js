'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createBrowserClient } from '../../../lib/supabase'
import ScoreBadge from '../../components/ScoreBadge'
import MeetingBadge from '../../components/MeetingBadge'
import Nav from '../../components/Nav'
import { isInterimPeriod, getCurrentBiennium, getNextBiennium, formatSessionDate } from '../../../lib/session-config'

// Historical pass rates by score bucket (Phase 7D.3: bills-only, 3 bienniums, N=8,062, 2,155 LAW)
const BUCKET_RATES = [
  { min: 0,  max: 30,  rate: 0,    label: '<1% of similar bills became law' },
  { min: 30, max: 45,  rate: 0,    label: '<1% of similar bills became law' },
  { min: 45, max: 60,  rate: 0,    label: '<1% of similar bills became law' },
  { min: 60, max: 75,  rate: 1.8,  label: '~1 in 55 similar bills became law' },
  { min: 75, max: 100, rate: 84.0, label: '~5 in 6 similar bills became law' },
]

function getBucketLabel(score) {
  const s = score || 0
  for (const b of BUCKET_RATES) {
    if (s >= b.min && s < b.max) return b
    if (b.max === 100 && s >= b.min) return b
  }
  return BUCKET_RATES[0]
}

// Pipeline stages that actually appear in the data (stage 2 and 5 never
// populated — WA bills jump 1->3 and 4->6). Labels describe what happened.
const PIPELINE_STAGES = [
  { num: 1, label: 'Introduced' },
  { num: 3, label: 'Out of Cmte' },
  { num: 4, label: 'Passed Floor' },
  { num: 6, label: 'Signed' },
]

/* ── Phase 7W.3: Companion state glyph + tooltip helpers ─────────────
 * Five-state relational signal — see sync-v2.js COMPANION_XF_WEIGHTS. */
const COMPANION_STATES = {
  both_moving: {
    glyph: '\u21C4',  // ⇄ left-right arrows
    label: 'Both moving',
    tooltip: 'Both this bill and its companion are advancing in parallel — the strongest bipartisan-chamber signal the data produces.',
    tone: 'positive',
  },
  leading: {
    glyph: '\u2190',  // ← left arrow (this side ahead)
    label: 'Leading',
    tooltip: 'This bill is further along than its companion in the other chamber. Leading pairs disproportionately become law when the trailing side catches up.',
    tone: 'positive',
  },
  trailing: {
    glyph: '\u2192',  // → right arrow (other side ahead)
    label: 'Trailing',
    tooltip: 'The companion in the other chamber is further along than this bill. Trailing can still converge, but the other chamber is carrying the pair.',
    tone: 'neutral',
  },
  forked: {
    glyph: '\u26A0',  // ⚠ warning sign
    label: 'Diverged',
    tooltip: 'The pair has diverged — one side is stalled or held while the other is still moving. Divergent pairs often end with only one side (or neither) becoming law.',
    tone: 'negative',
  },
  both_stuck: {
    glyph: '\u00B7\u00B7',  // ·· two dots (dormant)
    label: 'Both stuck',
    tooltip: 'Neither this bill nor its companion has advanced recently. Small residual bump over a solo bill — the existence of a companion keeps a narrow revival path open.',
    tone: 'neutral',
  },
}

function getCompanionStageLabel(stage) {
  if (stage == null) return null
  // Match PIPELINE_STAGES shape; WA bills rarely populate stage 2 or 5.
  if (stage >= 6) return 'Signed'
  if (stage >= 5) return 'Passed both'
  if (stage >= 4) return 'Passed floor'
  if (stage >= 3) return 'Out of cmte'
  if (stage >= 2) return 'In committee'
  return 'Introduced'
}

/* ── X-Factor tooltip descriptions ──────────────────── */
const XF_TOOLTIPS = {
  'Companion bill':      'A matching bill was introduced in the other chamber, doubling the chances of movement.',
  'Companion both moving':          'Both this bill and its companion are advancing in parallel — strongest bipartisan-chamber signal the data produces.',
  'Companion leading (this bill)':  'This bill is further along than its companion. Leading pairs disproportionately become law when the other side catches up.',
  'Companion leading (other chamber)': 'The companion is further along than this bill. Trailing can still converge, but the other chamber is carrying the pair.',
  'Companion divergence risk':      'The pair has diverged — one side is stalled or held while the other is still moving. Divergent pairs often end with only one side (or neither) becoming law.',
  'Companion both stuck':           'Neither this bill nor its companion has advanced recently. A small residual bump over a solo bill.',
  'Companion (unresolved)':         'A companion bill exists, but tonight\u2019s sync hasn\u2019t classified the relationship yet.',
  'Substitute filed':    'A revised version was filed, signaling active committee engagement.',
  'Exec session passed': 'The committee held an executive session and voted the bill out.',
  '2nd chamber':         'The bill has crossed to the opposite chamber \u2014 a major milestone.',
  'Pulled from Rules':   'Leadership pulled this bill from the Rules committee for a floor vote.',
  'Strong margin':       'Floor vote passed with a wide margin (+10% or more), signaling broad support.',
  'Double referral':     'Referred to two committees, which slows progress and adds veto points.',
  'High amendments':     'More than 3 amendments filed, indicating contested provisions.',
  'Fiscal referral':     'Sent to a fiscal committee for cost review, adding an extra hurdle.',
  'Stalled':             'No movement detected for an extended period \u2014 bill may be parked.',
  'Held in Rules':       'Stuck in Rules committee without being pulled for a floor vote.',
  'Minority only':       'Sponsored only by the minority party, reducing passage odds in a majority-controlled chamber.',
  'Narrow margin':       'Floor vote passed by a slim margin, suggesting fragile support.',
  'Cutoff warning':      'Approaching a legislative cutoff deadline \u2014 time pressure is building.',
}

/* ── Animated Sparkline Component ─────────────────── */
function AnimatedSparkline({ scores, snapshots, stageLabels }) {
  const svgRef = useRef(null)
  const [pathLen, setPathLen] = useState(0)
  const [drawn, setDrawn] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState(null)

  const W = 320, H = 120, PAD = 16
  const max = Math.max(...scores, 1)
  const min = Math.min(...scores, 0)
  const range = max - min || 1

  const points = scores.map((s, i) => ({
    x: PAD + (i / Math.max(scores.length - 1, 1)) * (W - PAD * 2),
    y: PAD + (1 - (s - min) / range) * (H - PAD * 2),
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = linePath + ` L${points[points.length - 1]?.x || PAD},${H} L${PAD},${H} Z`

  useEffect(() => {
    if (svgRef.current) {
      const path = svgRef.current.querySelector('.spark-line')
      if (path) {
        const len = path.getTotalLength()
        setPathLen(len)
        setTimeout(() => setDrawn(true), 50)
      }
    }
  }, [scores])

  if (scores.length < 2) return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
      More data after multiple sync cycles
    </div>
  )

  const last = points[points.length - 1]

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="sparkGradDark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(184,151,90,0.25)"/>
            <stop offset="100%" stopColor="rgba(184,151,90,0)"/>
          </linearGradient>
          <filter id="glowFilter">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(pct => (
          <line key={pct}
            x1={PAD} y1={PAD + (1 - pct) * (H - PAD * 2)}
            x2={W - PAD} y2={PAD + (1 - pct) * (H - PAD * 2)}
            stroke="var(--border)" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.5"
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#sparkGradDark)"
          style={{ opacity: drawn ? 1 : 0, transition: 'opacity 0.8s ease 0.6s' }}
        />

        {/* Glow line (behind main) */}
        <path d={linePath} fill="none" stroke="rgba(184,151,90,0.3)" strokeWidth="6"
          filter="url(#glowFilter)" strokeLinecap="round" strokeLinejoin="round"
          style={{
            strokeDasharray: pathLen || 1000,
            strokeDashoffset: drawn ? 0 : (pathLen || 1000),
            transition: 'stroke-dashoffset 1.2s ease-out',
          }}
        />

        {/* Main line */}
        <path className="spark-line" d={linePath} fill="none"
          stroke="var(--teal)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            strokeDasharray: pathLen || 1000,
            strokeDashoffset: drawn ? 0 : (pathLen || 1000),
            transition: 'stroke-dashoffset 1.2s ease-out',
          }}
        />

        {/* Stage labels on x-axis */}
        {stageLabels && stageLabels.length > 0 && stageLabels.map((lbl, i) => {
          const x = PAD + (i / Math.max(stageLabels.length - 1, 1)) * (W - PAD * 2)
          return (
            <text key={i} x={x} y={H - 2} textAnchor="middle"
              fill="var(--text-faint)" fontSize="7" fontFamily="var(--font-mono)">
              {lbl}
            </text>
          )
        })}

        {/* Current position dot */}
        {last && hoveredIdx === null && (
          <g style={{ opacity: drawn ? 1 : 0, transition: 'opacity 0.3s ease 1.2s' }}>
            <circle cx={last.x} cy={last.y} r="8" fill="rgba(184,151,90,0.15)"
              style={{ animation: 'dotPulse 2s ease-in-out infinite' }}/>
            <circle cx={last.x} cy={last.y} r="4" fill="var(--teal)"
              style={{ filter: 'drop-shadow(0 0 6px rgba(184,151,90,0.6))' }}/>
          </g>
        )}

        {/* Hover zones */}
        {drawn && points.map((p, i) => {
          const zoneW = (W - PAD * 2) / Math.max(scores.length - 1, 1)
          return (
            <rect key={i} x={p.x - zoneW / 2} y={0} width={zoneW} height={H}
              fill="transparent"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: 'crosshair' }}
            />
          )
        })}

        {/* Hovered point indicator */}
        {hoveredIdx !== null && points[hoveredIdx] && (
          <g>
            <line x1={points[hoveredIdx].x} y1={PAD} x2={points[hoveredIdx].x} y2={H - PAD}
              stroke="rgba(184,151,90,0.3)" strokeWidth="1" strokeDasharray="3 3"/>
            <circle cx={points[hoveredIdx].x} cy={points[hoveredIdx].y} r="4"
              fill="var(--teal)" stroke="var(--bg-card)" strokeWidth="2"
              style={{ filter: 'drop-shadow(0 0 4px rgba(184,151,90,0.5))' }}/>
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hoveredIdx !== null && points[hoveredIdx] && (
        <div style={{
          position: 'absolute',
          left: `${(points[hoveredIdx].x / W) * 100}%`,
          top: Math.max(0, points[hoveredIdx].y - 8),
          transform: 'translate(-50%, -100%)',
          background: 'rgba(14,16,20,0.95)',
          border: '1px solid rgba(184,151,90,0.3)',
          borderRadius: 6, padding: '4px 8px',
          pointerEvents: 'none', whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 10,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>
            {scores[hoveredIdx]}
          </div>
          {snapshots[hoveredIdx]?.snapshot_date && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)' }}>
              {new Date(snapshots[hoveredIdx].snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
      )}

      {/* Score at end */}
      {last && hoveredIdx === null && (
        <div style={{
          position: 'absolute', right: 0, top: 0,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--teal)', fontWeight: 600,
          textShadow: '0 0 8px rgba(184,151,90,0.4)',
          opacity: drawn ? 1 : 0, transition: 'opacity 0.3s ease 1.4s',
        }}>
          {scores[scores.length - 1]}
        </div>
      )}
    </div>
  )
}

export default function BillDetailPage() {
  const router = useRouter()
  const params = useParams()
  const billId = params.id
  const supabase = createBrowserClient()

  const [bill, setBill]         = useState(null)
  const [snapshots, setSnapshots] = useState([])
  const [latestSnap, setLatestSnap] = useState(null)
  const [tracked, setTracked]   = useState(null)
  const [tab, setTab]           = useState('trajectory')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [notes, setNotes]       = useState('')
  const [clientTag, setClientTag] = useState('')
  const [user, setUser]         = useState(null)
  const [shared, setShared]     = useState(false)
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false)
  const [vetoCtx, setVetoCtx] = useState(null) // Phase 11.3: historic veto rate for this bill's category
  const [companionSnaps, setCompanionSnaps] = useState([]) // Phase 11.4: companion stage over last 30 days
  const [amendments, setAmendments] = useState([])
  const [fiscalHistory, setFiscalHistory] = useState([])
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [savingSummary, setSavingSummary] = useState(false)
  // Phase 7S: Analyst notes (bill_notes table)
  const [billNotes, setBillNotes]       = useState([])
  const [noteBody, setNoteBody]         = useState('')
  const [noteVis, setNoteVis]           = useState('internal')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [savingNote, setSavingNote]     = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      const { data: billData } = await supabase
        .from('bills')
        .select('*')
        .eq('bill_id', billId)
        .single()
      setBill(billData)

      // Phase 11.3: Historic veto context for this bill's category (closed
      // biennia only). Display-only; not a scoring input. UI enforces n>=15
      // floor before showing.
      if (billData?.category) {
        const { data: vetoRow } = await supabase
          .from('bill_category_veto_rates')
          .select('*')
          .eq('category', billData.category)
          .maybeSingle()
        if (vetoRow && vetoRow.reached_governor >= 15) setVetoCtx(vetoRow)
      }

      // Phase 11.4: Companion snapshots over the last 30 days for the Parallel
      // Track widget. Only fetched when a companion exists. Display-only.
      if (billData?.companion_bill) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10)
        const { data: compSnaps } = await supabase
          .from('companion_snapshots')
          .select('snapshot_date, companion_stage, companion_score, companion_state')
          .eq('bill_id', billId)
          .gte('snapshot_date', thirtyDaysAgo)
          .order('snapshot_date', { ascending: true })
        setCompanionSnaps(compSnaps || [])
      }

      const { data: snapData } = await supabase
        .from('trajectory_snapshots')
        .select('snapshot_date, score, stage, pass_probability, committee_score, sponsor_score, momentum_score, historical_score, fiscal_score, xf_factors, xf_multiplier')
        .eq('bill_id', billId)
        .order('snapshot_date', { ascending: true })
        .limit(30)

      const snaps = snapData || []
      setSnapshots(snaps)
      if (snaps.length > 0) setLatestSnap(snaps[snaps.length - 1])

      if (user) {
        const { data: trackData } = await supabase
          .from('tracked_bills')
          .select('*')
          .eq('bill_id', billId)
          .eq('user_id', user.id)
          .maybeSingle()
        if (trackData) {
          setTracked(trackData)
          setNotes(trackData.notes || '')
          setClientTag(trackData.client_tag || '')
        }

        // Phase 7S: fetch analyst notes for this bill
        const { data: notesData } = await supabase
          .from('bill_notes')
          .select('*')
          .eq('bill_id', billId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        setBillNotes(notesData || [])
      }

      // Phase 10.3: Fetch amendments and fiscal note history for timeline
      const { data: amendData } = await supabase
        .from('amendments')
        .select('*')
        .eq('bill_id', billId)
        .order('floor_action_date', { ascending: false, nullsFirst: false })
      setAmendments(amendData || [])

      const { data: fiscalData } = await supabase
        .from('fiscal_note_history')
        .select('*')
        .eq('bill_id', billId)
        .order('detected_date', { ascending: false })
      setFiscalHistory(fiscalData || [])

      setLoading(false)
    }
    load()
  }, [billId])

  async function toggleWatch() {
    if (!user) return
    setSaving(true)
    if (tracked) {
      await supabase.from('tracked_bills')
        .delete()
        .eq('bill_id', billId)
        .eq('user_id', user.id)
      setTracked(null)
    } else {
      const { data } = await supabase
        .from('tracked_bills')
        .insert({ bill_id: billId, user_id: user.id, notes, client_tag: clientTag })
        .select()
        .single()
      setTracked(data)
    }
    setSaving(false)
  }

  async function saveNotes() {
    if (!user || !tracked) return
    setSaving(true)
    await supabase.from('tracked_bills')
      .update({ notes, client_tag: clientTag })
      .eq('bill_id', billId)
      .eq('user_id', user.id)
    setSaving(false)
  }

  // ── Phase 7S: Analyst Note CRUD ──────────────────────
  async function saveNote() {
    if (!user || !noteBody.trim()) return
    setSavingNote(true)
    if (editingNoteId) {
      const { data } = await supabase
        .from('bill_notes')
        .update({ body: noteBody.trim(), visibility: noteVis })
        .eq('id', editingNoteId)
        .eq('user_id', user.id)
        .select()
        .single()
      if (data) {
        setBillNotes(prev => prev.map(n => n.id === editingNoteId ? data : n))
      }
      setEditingNoteId(null)
    } else {
      const { data } = await supabase
        .from('bill_notes')
        .insert({ bill_id: billId, user_id: user.id, body: noteBody.trim(), visibility: noteVis })
        .select()
        .single()
      if (data) {
        setBillNotes(prev => [data, ...prev])
      }
    }
    setNoteBody('')
    setNoteVis('internal')
    setSavingNote(false)
  }

  function startEditNote(note) {
    setEditingNoteId(note.id)
    setNoteBody(note.body)
    setNoteVis(note.visibility)
  }

  function cancelEditNote() {
    setEditingNoteId(null)
    setNoteBody('')
    setNoteVis('internal')
  }

  async function deleteNote(noteId) {
    await supabase
      .from('bill_notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', user.id)
    setBillNotes(prev => prev.filter(n => n.id !== noteId))
  }

  async function shareBill() {
    if (!bill) return
    const prefix = bill.chamber === 'House' ? 'HB' : 'SB'
    const bucket = getBucketLabel(bill.final_score)
    const text = `${prefix}${bill.bill_number}: ${bill.title}\nTrajectory Score: ${bill.final_score || 0}/100 · ${bucket.rate > 0 ? bucket.rate + '% historical pass rate' : 'Very low historical pass rate'}\n— Vector | WA`
    try {
      await navigator.clipboard.writeText(text)
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    } catch { /* fallback: no-op */ }
  }

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font-body)', background: 'var(--bg)', minHeight: '100vh' }}>
      Loading...
    </div>
  )
  if (!bill) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font-body)', background: 'var(--bg)', minHeight: '100vh' }}>
      Bill not found.
    </div>
  )

  const score = bill.final_score || 0
  const passPct = Math.round((bill.pass_probability || 0) * 100)
  const scoreColor = score >= 60 ? 'var(--teal)'
    : score >= 45 ? 'var(--teal-mid)'
    : score >= 30 ? 'var(--gold)'
    : 'var(--text-muted)'

  const sparkScores = snapshots.map(s => s.score ?? 0).filter(s => s != null)

  // X Factors from latest snapshot
  const xfFactors = (latestSnap?.xf_factors) || []

  // Signal scores from latest snapshot
  const sig = latestSnap || {}
  const baseTotal = (sig.committee_score || 0) + (sig.sponsor_score || 0) + (sig.momentum_score || 0) + (sig.historical_score || 0) + (sig.fiscal_score || 0)
  const xfMult = bill.xf_multiplier || sig.xf_multiplier || 1

  const floorMargin = bill.avg_floor_margin ? Math.round(bill.avg_floor_margin * 100) : null

  // Build leg.wa.gov link
  const sessionYear = (bill.session || '2025-2026').split('-')[0]
  const legUrl = `https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${sessionYear}`

  // Velocity: is the score trending up from earliest snapshot?
  const velocityRising = sparkScores.length > 1 && score > sparkScores[0]

  // Confidence label styling (4 active tiers + 3 interim states)
  const confLabel = bill.confidence_label || 'VERY LOW'
  // 6L.2: VERY HIGH renamed to HIGH for consistency with signal_tier
  const confColor = confLabel === 'HIGH' ? 'var(--teal)'
    : confLabel === 'MODERATE' ? 'var(--gold)'
    : confLabel === 'LOW' ? 'var(--danger)'
    : confLabel === 'LAW' ? 'var(--teal)'
    : confLabel === 'CARRY OVER' ? 'var(--gold)'
    : confLabel === 'DEAD' ? 'var(--text-faint)'
    : 'var(--text-muted)' // VERY LOW

  return (
    <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>

      {/* ── STICKY HEADER ──────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '52px 16px 12px',
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--teal)', fontWeight: 500, cursor: 'pointer' }}>
          ← Back
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a
            href={legUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              padding: '7px 12px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 20, fontSize: 12, fontWeight: 500,
              color: 'var(--text-muted)',
              cursor: 'pointer', transition: 'all 0.15s',
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            leg.wa.gov
          </a>
          <button
            onClick={shareBill}
            style={{
              padding: '7px 12px',
              background: shared ? 'rgba(184,151,90,0.1)' : 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 20, fontSize: 12, fontWeight: 500,
              color: shared ? 'var(--teal)' : 'var(--text-muted)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >{shared ? '✓ Copied' : '↗ Share'}</button>
          <button
            onClick={toggleWatch}
            disabled={saving}
            style={{
              padding: '7px 16px',
              background: tracked ? 'var(--gold-pale)' : 'var(--teal-pale)',
              border: `1px solid ${tracked ? 'rgba(184,151,90,0.3)' : 'rgba(184,151,90,0.3)'}`,
              borderRadius: 20, fontSize: 12, fontWeight: 600,
              color: tracked ? 'var(--gold)' : 'var(--teal)',
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: tracked ? 'var(--gold-glow)' : 'none',
            }}
          >{tracked ? '🔖 Watching' : '+ Watch'}</button>
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* 6B.2: Session-ended banner for dead/carried-over bills during interim */}
        {isInterimPeriod() && bill.confidence_label === 'DEAD' && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '10px 14px',
            fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            This bill did not advance before session ended on {formatSessionDate(getCurrentBiennium().end)}. It may be reintroduced in the {getNextBiennium().session} session.
          </div>
        )}
        {isInterimPeriod() && bill.confidence_label === 'CARRY OVER' && (
          <div style={{
            background: 'rgba(184,151,90,0.06)', border: '1px solid rgba(184,151,90,0.2)',
            borderRadius: 'var(--radius)', padding: '10px 14px',
            fontSize: 12, color: 'var(--gold)', lineHeight: 1.5,
          }}>
            This bill passed at least one chamber and carries over within the {bill.session || '2025-2026'} biennium.
          </div>
        )}
        {isInterimPeriod() && bill.confidence_label === 'LAW' && (
          <div style={{
            background: 'rgba(184,151,90,0.06)', border: '1px solid rgba(184,151,90,0.2)',
            borderRadius: 'var(--radius)', padding: '10px 14px',
            fontSize: 12, color: 'var(--teal)', lineHeight: 1.5,
          }}>
            Signed into law.
          </div>
        )}

        {/* ── SPARKLINE HERO ──────────────────────────────── */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '16px', overflow: 'hidden',
          position: 'relative',
        }}>
          {/* Top badges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span
                title="Based on how similar bills performed this biennium. Bills with this score became law at this rate."
                style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 10,
                background: confLabel === 'HIGH' ? 'rgba(184,151,90,0.1)'
                  : confLabel === 'MODERATE' ? 'rgba(184,151,90,0.1)'
                  : confLabel === 'LOW' ? 'rgba(196,71,48,0.1)'
                  : 'rgba(100,120,140,0.1)',
                color: confColor,
                border: `1px solid ${confLabel === 'HIGH' ? 'rgba(184,151,90,0.2)'
                  : confLabel === 'MODERATE' ? 'rgba(184,151,90,0.2)'
                  : confLabel === 'LOW' ? 'rgba(196,71,48,0.2)'
                  : 'rgba(100,120,140,0.2)'}`,
                fontFamily: 'var(--font-mono)', fontWeight: 600,
                letterSpacing: '0.05em',
                cursor: 'help',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                {['LAW','DEAD','CARRY OVER'].includes(confLabel)
                  ? confLabel === 'LAW' ? 'Signed into law'
                  : confLabel === 'DEAD' ? 'Dead \u2014 did not pass'
                  : 'Passed chamber \u2014 did not become law'
                  : getBucketLabel(score).label}
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.6 }}>
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                  <text x="8" y="11.5" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="700" fontFamily="var(--font-mono)">i</text>
                </svg>
              </span>
              {!['LAW','DEAD','CARRY OVER'].includes(confLabel) && (
                <span style={{
                  fontSize: 8, padding: '2px 8px', borderRadius: 8,
                  background: 'rgba(100,120,140,0.06)',
                  color: confColor,
                  border: '1px solid rgba(100,120,140,0.12)',
                  fontFamily: 'var(--font-mono)', fontWeight: 500,
                }}>
                  {confLabel}
                </span>
              )}
              {!['DEAD','LAW','CARRY OVER'].includes(confLabel) && sparkScores.length > 1 && (
                <span style={{
                  fontSize: 9, padding: '3px 10px', borderRadius: 10,
                  background: velocityRising ? 'rgba(184,151,90,0.06)' : 'rgba(196,71,48,0.06)',
                  color: velocityRising ? 'var(--teal-mid)' : 'var(--danger)',
                  border: `1px solid ${velocityRising ? 'rgba(184,151,90,0.15)' : 'rgba(196,71,48,0.15)'}`,
                  fontFamily: 'var(--font-mono)', fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ color: velocityRising ? 'var(--gold)' : 'var(--danger)' }}>{velocityRising ? '▲' : '▼'}</span>
                  VELOCITY: {velocityRising ? 'RISING' : 'DECLINING'}
                </span>
              )}
            </div>
          </div>

          <div style={{ opacity: ['DEAD','CARRY OVER'].includes(confLabel) ? 0.4 : 1, transition: 'opacity 0.2s' }}>
            <AnimatedSparkline
              scores={sparkScores}
              snapshots={snapshots}
            />
          </div>

          {/* Date range */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            <span>{snapshots[0]?.snapshot_date ? new Date(snapshots[0].snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Start'}</span>
            <span>Today</span>
          </div>
        </div>

        {/* ── AI SUMMARY (editable) ──────────────────── */}
        {(bill.custom_summary || bill.ai_summary) && (
          <div style={{
            background: 'rgba(184,151,90,0.03)',
            border: '1px solid rgba(184,151,90,0.12)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--teal-mid)', fontWeight: 600, letterSpacing: '0.08em' }}>
                PLAIN ENGLISH SUMMARY
                {bill.custom_summary && (
                  <span style={{ marginLeft: 8, color: 'var(--gold)', fontWeight: 400 }}>· EDITED</span>
                )}
              </div>
              {user && !editingSummary && (
                <button
                  onClick={() => {
                    setSummaryDraft(bill.custom_summary || bill.ai_summary || '')
                    setEditingSummary(true)
                  }}
                  style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--gold)',
                    background: 'none', border: '1px solid rgba(184,151,90,0.25)',
                    borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                    letterSpacing: '0.05em',
                  }}
                >
                  EDIT
                </button>
              )}
            </div>

            {editingSummary ? (
              <>
                <textarea
                  value={summaryDraft}
                  onChange={e => setSummaryDraft(e.target.value)}
                  style={{
                    width: '100%', minHeight: 180, fontSize: 13, lineHeight: 1.6,
                    color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.15)',
                    border: '1px solid rgba(184,151,90,0.25)', borderRadius: 8,
                    padding: '10px 12px', fontFamily: 'inherit', resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    disabled={savingSummary}
                    onClick={async () => {
                      setSavingSummary(true)
                      const supabase = createBrowserClient()
                      await supabase.from('bills').update({
                        custom_summary: summaryDraft,
                        summary_locked: true,
                      }).eq('bill_id', bill.bill_id)
                      setBill(prev => ({ ...prev, custom_summary: summaryDraft, summary_locked: true }))
                      setEditingSummary(false)
                      setSavingSummary(false)
                    }}
                    style={{
                      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                      color: '#fff', background: 'var(--teal)', border: 'none',
                      borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
                      opacity: savingSummary ? 0.5 : 1,
                    }}
                  >
                    {savingSummary ? 'SAVING…' : 'SAVE'}
                  </button>
                  {bill.custom_summary && (
                    <button
                      disabled={savingSummary}
                      onClick={async () => {
                        setSavingSummary(true)
                        const supabase = createBrowserClient()
                        await supabase.from('bills').update({
                          custom_summary: null,
                          summary_locked: false,
                        }).eq('bill_id', bill.bill_id)
                        setBill(prev => ({ ...prev, custom_summary: null, summary_locked: false }))
                        setEditingSummary(false)
                        setSavingSummary(false)
                      }}
                      style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)',
                        color: 'var(--danger)', background: 'none',
                        border: '1px solid rgba(196,71,48,0.3)',
                        borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
                      }}
                    >
                      RESET TO AI
                    </button>
                  )}
                  <button
                    onClick={() => setEditingSummary(false)}
                    style={{
                      fontSize: 10, fontFamily: 'var(--font-mono)',
                      color: 'var(--text-faint)', background: 'none',
                      border: '1px solid rgba(184,151,90,0.15)',
                      borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {(bill.custom_summary || bill.ai_summary || '').split('\n').map((line, i) => {
                  const trimmed = line.trim()
                  // Section headers: **EXECUTIVE SUMMARY**, **WHO IS AFFECTED**, etc.
                  const headerMatch = trimmed.match(/^\*\*(.+?)\*\*$/)
                  if (headerMatch) {
                    return (
                      <div key={i} style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                        color: 'var(--teal)', letterSpacing: '0.06em',
                        marginTop: i > 0 ? 14 : 0, marginBottom: 4,
                        textTransform: 'uppercase',
                      }}>
                        {headerMatch[1]}
                      </div>
                    )
                  }
                  // Blank lines become spacing
                  if (!trimmed) return <div key={i} style={{ height: 6 }} />
                  // Paragraph text — handle inline **bold** within text
                  const parts = trimmed.split(/\*\*(.+?)\*\*/)
                  return (
                    <p key={i} style={{ margin: '0 0 4px 0' }}>
                      {parts.map((part, j) =>
                        j % 2 === 1
                          ? <strong key={j} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{part}</strong>
                          : <span key={j}>{part}</span>
                      )}
                    </p>
                  )
                })}
              </div>
            )}

            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(184,151,90,0.1)', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '0.05em', lineHeight: 1.5 }}>
              {bill.custom_summary
                ? <>Edited by operator. Original AI summary available via "Reset to AI". <a href="/disclaimers" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>Disclaimers</a>.</>
                : <>Generated by a large language model from this bill's official text. Not reviewed by a human. <a href="/disclaimers" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>Full disclaimers</a>.</>
              }
            </div>
          </div>
        )}

        {/* ── BILL IDENTITY ──────────────────────────────── */}
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{bill.chamber === 'House' ? 'HB' : 'SB'}{bill.bill_number}</span>
            <MeetingBadge billId={bill.bill_id} />
            {!bill.bipartisan && (
              <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(184,151,90,0.1)', color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 10 }}>
                Minority Only
              </span>
            )}
            {bill.category && (
              <span style={{ color: 'var(--text-faint)' }}>· {bill.category === 'Other' && bill.committee_name ? `Other — ${bill.committee_name.replace(/ \d+ Review$/, '').replace(/^Rules$/, 'General')}` : bill.category}</span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, marginBottom: bill.companion_bill ? 8 : 14 }}>
            {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
          </div>

          {/* Phase 7W.3: Enriched companion bill pill
              - stage label of the companion (e.g. "Out of cmte")
              - mini score tier pill (H/M/L/VL) sized for inline display
              - state glyph + label (both_moving / leading / trailing / forked / both_stuck)
              - hover tooltip with the state-specific description
              The pill only shows relational info if the companion has been
              resolved by sync-v2.js second pass (companion_state !== null). */}
          {bill.companion_bill && (() => {
            const compState = bill.companion_state
            const stateInfo = compState ? COMPANION_STATES[compState] : null
            const compStageLabel = getCompanionStageLabel(bill.companion_stage)
            const compScore = bill.companion_score
            // Tier derived from companion score (matches sync-v2.js signal_tier)
            let compTier = null
            if (compScore != null) {
              if (compScore >= 75) compTier = 'HIGH'
              else if (compScore >= 60) compTier = 'MODERATE'
              else if (compScore >= 45) compTier = 'LOW'
              else compTier = 'VERY LOW'
            }
            const tierColor = {
              'HIGH':      'var(--teal)',
              'MODERATE':  'var(--gold)',
              'LOW':       'rgba(184,151,90,0.5)',
              'VERY LOW':  'var(--text-faint)',
            }[compTier] || 'var(--text-faint)'
            // Border color shifts by tone when state is resolved
            const borderColorBase = stateInfo
              ? (stateInfo.tone === 'negative' ? 'rgba(220,120,90,0.25)'
                : stateInfo.tone === 'positive' ? 'rgba(74,196,183,0.28)'
                : 'rgba(184,151,90,0.2)')
              : 'rgba(184,151,90,0.15)'
            const borderColorHover = stateInfo
              ? (stateInfo.tone === 'negative' ? 'rgba(220,120,90,0.55)'
                : stateInfo.tone === 'positive' ? 'rgba(74,196,183,0.6)'
                : 'rgba(184,151,90,0.5)')
              : 'rgba(184,151,90,0.4)'

            return (
              <div
                title={stateInfo ? `${stateInfo.label} — ${stateInfo.tooltip}` : 'Companion bill — click to open'}
                onClick={async () => {
                  const compNum = bill.companion_bill.replace(/\D/g, '')
                  const { data } = await supabase
                    .from('bills')
                    .select('bill_id')
                    .eq('bill_number', compNum)
                    .eq('session', bill.session || '2025-2026')
                    .maybeSingle()
                  if (data?.bill_id) router.push(`/bill/${data.bill_id}`)
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', marginBottom: 14,
                  background: 'rgba(184,151,90,0.06)',
                  border: `1px solid ${borderColorBase}`,
                  borderRadius: 10, cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = borderColorHover}
                onMouseLeave={e => e.currentTarget.style.borderColor = borderColorBase}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <span style={{ fontSize: 11, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  Companion: {bill.companion_bill}
                </span>
                {compStageLabel && (
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '2px 6px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                  }}>
                    {compStageLabel}
                  </span>
                )}
                {compScore != null && (
                  <span style={{
                    fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: tierColor,
                    padding: '2px 6px',
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${tierColor}`,
                    borderRadius: 6,
                    lineHeight: 1.1,
                  }}>
                    {compScore}
                  </span>
                )}
                {stateInfo && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontFamily: 'var(--font-mono)',
                    color: stateInfo.tone === 'negative' ? 'rgba(220,120,90,0.95)'
                         : stateInfo.tone === 'positive' ? 'var(--teal)'
                         : 'var(--text-muted)',
                  }}>
                    <span style={{ fontSize: 13, lineHeight: 1 }}>{stateInfo.glyph}</span>
                    <span>{stateInfo.label}</span>
                  </span>
                )}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            )
          })()}

          {/* ── Phase 11.4: Parallel Track widget ──────────────────────────
              Dual-lane sparkline — this bill's stage vs. companion's stage
              over the last 30 days. Renders when a companion exists AND at
              least two companion snapshots have accumulated. Purely
              descriptive; no scoring tie-in. */}
          {bill.companion_bill && companionSnaps.length >= 2 && (() => {
            // Build per-day stage series for each lane. Missing days
            // carry-forward the previous stage so the line is continuous.
            const today = new Date()
            const days = []
            for (let i = 29; i >= 0; i--) {
              const d = new Date(today)
              d.setDate(d.getDate() - i)
              days.push(d.toISOString().slice(0, 10))
            }
            const mySnapMap = new Map(snapshots.map(s => [s.snapshot_date, s.stage]))
            const compSnapMap = new Map(companionSnaps.map(s => [s.snapshot_date, s.companion_stage]))

            let lastMine = null, lastComp = null
            const mySeries = [], compSeries = []
            for (const d of days) {
              if (mySnapMap.has(d)) lastMine = mySnapMap.get(d)
              if (compSnapMap.has(d)) lastComp = compSnapMap.get(d)
              mySeries.push(lastMine)
              compSeries.push(lastComp)
            }

            const W = 280, H = 64, PAD_X = 4, PAD_Y = 6
            const stageFloor = 1, stageCeil = 6
            const xStep = (W - PAD_X * 2) / (days.length - 1)
            const yFor = stage => {
              if (stage == null) return null
              const clamped = Math.max(stageFloor, Math.min(stageCeil, stage))
              const pct = (clamped - stageFloor) / (stageCeil - stageFloor)
              return H - PAD_Y - pct * (H - PAD_Y * 2)
            }
            const buildPath = series => {
              let d = ''
              series.forEach((s, i) => {
                const y = yFor(s)
                if (y == null) return
                const x = PAD_X + i * xStep
                d += d === '' ? `M ${x} ${y}` : ` L ${x} ${y}`
              })
              return d
            }

            // State-derived color + readout (use the most recent snapshot's state)
            const latestState = companionSnaps[companionSnaps.length - 1]?.companion_state
            const stateInfo = latestState ? COMPANION_STATES[latestState] : null
            const lineColor = stateInfo
              ? (stateInfo.tone === 'positive' ? 'var(--teal)'
                : stateInfo.tone === 'negative' ? 'rgba(220,120,90,0.95)'
                : 'var(--gold)')
              : 'var(--text-muted)'

            const readout = (() => {
              if (latestState === 'both_moving') return 'Both chambers moving in lockstep.'
              if (latestState === 'leading') return `This bill leads ${bill.companion_bill} by stage.`
              if (latestState === 'trailing') return `${bill.companion_bill} is out ahead in the other chamber.`
              if (latestState === 'forked') return `Pair has diverged — neither side has moved in ≥14 days.`
              if (latestState === 'both_stuck') return 'Both sides holding. Interim or pre-cutoff pause.'
              return 'Companion pair — state pending.'
            })()

            return (
              <div style={{
                marginBottom: 14, padding: '10px 12px',
                background: 'rgba(184,151,90,0.04)',
                border: '1px solid var(--border)',
                borderRadius: 10,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Parallel track · last 30 days
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {readout}
                  </span>
                </div>
                <svg width={W} height={H} style={{ display: 'block', width: '100%', maxWidth: W, height: H }}>
                  {/* Stage gridlines */}
                  {[1, 3, 4, 6].map(s => {
                    const y = yFor(s)
                    return (
                      <line key={s} x1={PAD_X} y1={y} x2={W - PAD_X} y2={y}
                        stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,3" opacity="0.4" />
                    )
                  })}
                  {/* Companion lane — thinner, behind */}
                  <path d={buildPath(compSeries)} fill="none"
                    stroke={lineColor} strokeWidth="1.25" opacity="0.55"
                    strokeDasharray="3,2" strokeLinecap="round" strokeLinejoin="round" />
                  {/* This bill lane — solid, on top */}
                  <path d={buildPath(mySeries)} fill="none"
                    stroke={lineColor} strokeWidth="1.75"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div style={{
                  display: 'flex', gap: 14, marginTop: 6,
                  fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)',
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 14, height: 2, background: lineColor, display: 'inline-block' }} />
                    {bill.bill_number}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 14, height: 2, background: lineColor, opacity: 0.55, display: 'inline-block', borderTop: `1px dashed ${lineColor}` }} />
                    {bill.companion_bill}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* ── Phase 11.5: Calendar pressure badge ─────────────────────────
              Compact chip showing "Crowded docket — N items this week" when
              this bill's committee is carrying 20+ agenda items across its
              scheduled meetings in the next 7 days. Purely descriptive — the
              scoring engine does NOT read bills.calendar_pressure; this is
              instrumentation for post-2027 calibration. */}
          {bill.calendar_pressure != null && bill.calendar_pressure >= 20 && bill.calendar_pressure_next_meeting && (() => {
            const next = new Date(bill.calendar_pressure_next_meeting + 'T00:00:00')
            const daysOut = Math.round((next - new Date()) / (1000 * 60 * 60 * 24))
            if (daysOut < 0 || daysOut > 7) return null
            const nextLabel = next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            return (
              <div
                title={`${bill.calendar_pressure} agenda items across ${bill.committee_name || 'the committee'}'s scheduled meetings in the next 7 days. Next meeting: ${nextLabel}.`}
                style={{
                  marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 9px',
                  background: 'rgba(196,122,48,0.08)',
                  border: '1px solid rgba(196,122,48,0.28)',
                  borderRadius: 10,
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--gold)', letterSpacing: '0.02em',
                  cursor: 'help',
                }}
              >
                <span style={{ fontWeight: 600 }}>◐ Crowded docket</span>
                <span style={{ opacity: 0.8 }}>
                  {bill.calendar_pressure} items this week · next {nextLabel}
                </span>
              </div>
            )
          })()}

          {/* ── Phase 11.3: RCW cites + historic veto context ───────────────
              Both are display-only, decision-grade context strips. Shown
              inline under the companion pill so the analyst sees them before
              the score card loads the interpretive narrative. */}
          {Array.isArray(bill.rcw_cites) && bill.rcw_cites.length > 0 && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Cited RCWs
              </span>
              {bill.rcw_cites.map((c, i) => (
                <a
                  key={`${c.cite}-${i}`}
                  href={`https://app.leg.wa.gov/RCW/default.aspx?cite=${encodeURIComponent(c.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${c.cite} on leg.wa.gov`}
                  style={{
                    fontSize: 10, fontFamily: 'var(--font-mono)',
                    color: 'var(--teal)', textDecoration: 'none',
                    padding: '3px 8px',
                    background: 'rgba(74,196,183,0.06)',
                    border: '1px solid rgba(74,196,183,0.22)',
                    borderRadius: 10,
                  }}
                >
                  {c.title}
                </a>
              ))}
            </div>
          )}

          {vetoCtx && (
            <div
              title={`Of ${vetoCtx.reached_governor} ${vetoCtx.category} bills that reached the governor in 2021–2024, ${vetoCtx.veto_count} were vetoed (${vetoCtx.full_veto_count} full, ${vetoCtx.partial_veto_count} partial). Historic context only — not a scoring input.`}
              style={{
                marginBottom: 12,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                fontSize: 11, fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Historic veto context
              </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {vetoCtx.veto_rate_pct}%
              </span>
              <span>
                of <em>{vetoCtx.category}</em> bills vetoed at the governor ({vetoCtx.veto_count} of {vetoCtx.reached_governor}, 2021–2024)
              </span>
            </div>
          )}

          {/* Score + Score breakdown row */}
          <div style={{
            background: 'linear-gradient(135deg, #0e1014 0%, #0a0c12 100%)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '16px', display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <ScoreBadge score={score} size="lg" status={confLabel}/>
            <div style={{ flex: 1 }}>
              {/* Phase 5C.5: trajectory score info icon + tooltip */}
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Trajectory Score</span>
                <button
                  type="button"
                  aria-label="About the trajectory score"
                  onClick={() => setScoreInfoOpen(v => !v)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-faint)', padding: 0, lineHeight: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                  </svg>
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  BASE {baseTotal || bill.trajectory_score || '—'}
                </span>
                {xfMult && xfMult !== 1 && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>×</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                      {Number(xfMult).toFixed(2)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>=</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>
                      {score}
                    </span>
                  </>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {['LAW', 'CARRY OVER', 'DEAD'].includes(confLabel)
                  ? <>{confLabel === 'LAW' ? 'Signed into law' : confLabel === 'CARRY OVER' ? 'Carried over to next session' : 'Dead — session ended'}{bill.signal_tier && <> · Signal was <span style={{ color: bill.signal_tier === 'HIGH' ? 'var(--teal)' : bill.signal_tier === 'MODERATE' ? 'var(--gold)' : 'var(--text-faint)' }}>{bill.signal_tier}</span></>}</>
                  : <>{getBucketLabel(score).rate}% historical pass rate · <span style={{ color: confColor }}>{confLabel}</span> signal</>
                }
              </div>
            </div>
          </div>

          {/* Phase 5C.5: Trajectory score explanation panel */}
          {scoreInfoOpen && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px 16px', fontSize: 12,
              color: 'var(--text-muted)', lineHeight: 1.6,
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                How the trajectory score works
              </div>
              <div style={{ marginBottom: 8 }}>
                The score is a weighted sum of five signal components, multiplied by an X-factor adjustment, capped at 99 (100 is reserved for bills signed into law):
              </div>
              <ul style={{ margin: '0 0 8px 18px', padding: 0 }}>
                <li><strong style={{ color: 'var(--text-primary)' }}>Committee (0–25)</strong> — hearings held, executive action, committee passage</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Sponsor (0–20)</strong> — majority party, chair status, bipartisan cosponsors</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Momentum (0–20)</strong> — recent activity, substitutes filed, stalled penalties</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Historical (0–20)</strong> — category pass rates from prior sessions</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Fiscal (0–15)</strong> — lower for bills with larger fiscal notes</li>
              </ul>
              <div style={{ marginBottom: 8 }}>
                <strong style={{ color: 'var(--text-primary)' }}>X factors</strong> are positive or negative multipliers (companion bills, cutoff pressure, held in Rules, narrow margins, etc.) that adjust the base total by ±50%.
              </div>
              <div>
                Signal strength (HIGH / MODERATE / LOW / VERY LOW) is <strong style={{ color: 'var(--text-primary)' }}>calibrated against actual 2025–2026 session outcomes</strong> — the percentages reflect the share of real bills in each band that became law. During interim, labels change to LAW / CARRY OVER / DEAD to reflect session results. Read more on the <a href="/methodology" style={{ color: 'var(--teal)' }}>methodology page</a>.
              </div>
            </div>
          )}
        </div>

        {/* ── KEY INFO GRID ──────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'Committee', value: bill.committee_name || 'No committee assigned' },
            { label: 'Prime Sponsor', value: bill.prime_sponsor ? `${bill.prime_sponsor}${bill.prime_party ? ` (${bill.prime_party.charAt(0)})` : ''}` : '—',
              extra: bill.is_committee_chair ? '✦ Committee Chair' : null, extraColor: 'var(--teal)' },
            ...(isInterimPeriod() && ['DEAD','LAW','CARRY OVER'].includes(confLabel)
              ? [{ label: 'Session', value: `Ended ${formatSessionDate(getCurrentBiennium().end)}`, extraColor: 'var(--text-muted)' }]
              : [
                { label: 'Hearing', value: bill.hearing_date ? new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'None scheduled' },
                { label: 'To Cutoff', value: bill.days_to_cutoff != null ? (bill.days_to_cutoff > 10 ? 'Safe' : bill.days_to_cutoff > 0 ? `${bill.days_to_cutoff}d` : 'Passed') : '—',
                  extraColor: bill.days_to_cutoff > 10 ? 'var(--teal)' : bill.days_to_cutoff > 0 ? 'var(--gold)' : 'var(--text-muted)' },
              ]),
            { label: 'Floor Margin', value: floorMargin !== null ? `${floorMargin > 0 ? '+' : ''}${floorMargin}%` : 'No vote yet',
              extraColor: floorMargin !== null ? (floorMargin >= 10 ? 'var(--teal)' : floorMargin >= 0 ? 'var(--gold)' : 'var(--danger)') : undefined },
            { label: 'Fiscal', value: bill.fiscal_note_size ? bill.fiscal_note_size.charAt(0).toUpperCase() + bill.fiscal_note_size.slice(1) : '—' },
          ].map(({ label, value, extra, extraColor }) => (
            <div key={label} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '10px 12px',
            }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: extraColor || 'var(--text-primary)', fontWeight: 500, lineHeight: 1.3 }}>{value}</div>
              {extra && <div style={{ fontSize: 9, color: extraColor, marginTop: 2, fontFamily: 'var(--font-mono)' }}>{extra}</div>}
            </div>
          ))}
        </div>

        {/* ── X FACTOR PILLS ─────────────────────────────── */}
        {xfFactors.length > 0 && (
          <div style={{ opacity: ['DEAD','LAW','CARRY OVER'].includes(confLabel) ? 0.45 : 1, transition: 'opacity 0.2s' }}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              {['DEAD','LAW','CARRY OVER'].includes(confLabel) ? 'Historical Signals (session ended)' : 'X Factors'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {xfFactors.map((f, i) => {
                // Match tooltip by prefix (handles dynamic labels like "Cutoff: 3d")
                const tooltipKey = Object.keys(XF_TOOLTIPS).find(k => f.l.startsWith(k)) || f.l
                const tooltip = XF_TOOLTIPS[tooltipKey] || ''
                return (
                  <div key={i} title={tooltip} style={{
                    padding: '5px 12px', borderRadius: 16,
                    fontSize: 11, fontWeight: 500,
                    background: f.pos ? 'rgba(184,151,90,0.08)' : 'var(--danger-pale)',
                    color: f.pos ? 'var(--teal)' : 'var(--danger)',
                    border: `1px solid ${f.pos ? 'rgba(184,151,90,0.2)' : 'rgba(196,71,48,0.2)'}`,
                    boxShadow: f.pos ? '0 0 8px rgba(184,151,90,0.1)' : '0 0 8px rgba(196,71,48,0.1)',
                    cursor: tooltip ? 'help' : 'default',
                  }}>
                    {f.pos ? '▲' : '▼'} {f.l} {f.d > 0 ? '+' : ''}{Math.round(f.d * 100)}%
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── POLITICAL DYNAMICS (Phase 8) ─────────────────── */}
        {(bill.bipartisan_index != null || bill.chair_alignment || bill.sponsor_track_record != null || bill.cross_aisle_count > 0) && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '14px 16px',
            opacity: ['DEAD','LAW','CARRY OVER'].includes(confLabel) ? 0.55 : 1,
            transition: 'opacity 0.2s',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
                Political Dynamics
              </div>
              <a href="/methodology#political-dynamics" style={{ fontSize: 9, color: 'var(--text-faint)', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>
                How it works →
              </a>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {/* Bipartisan / Partisan badge */}
              {bill.bipartisan_index != null && (() => {
                const bpi = bill.bipartisan_index
                const label = bpi > 0.3 ? 'BIPARTISAN' : bpi < 0.1 ? 'PARTISAN' : 'MIXED'
                const color = bpi > 0.3 ? 'var(--teal)' : bpi < 0.1 ? 'var(--text-faint)' : 'var(--gold)'
                const bg = bpi > 0.3 ? 'rgba(184,151,90,0.08)' : bpi < 0.1 ? 'rgba(100,120,140,0.06)' : 'rgba(255,201,74,0.06)'
                const border = bpi > 0.3 ? 'rgba(184,151,90,0.2)' : bpi < 0.1 ? 'rgba(100,120,140,0.15)' : 'rgba(255,201,74,0.15)'
                return (
                  <div title={`Bipartisan Index: ${Math.round(bpi * 100)}% of co-sponsors are from the opposite party of the prime sponsor. Above 30% = Bipartisan, below 10% = Partisan.`} style={{
                    padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                    background: bg, color, border: `1px solid ${border}`, cursor: 'help',
                  }}>
                    {label} · {Math.round(bpi * 100)}%
                  </div>
                )
              })()}

              {/* Chair Alignment badge */}
              {bill.chair_alignment && (() => {
                const a = bill.chair_alignment
                const label = a === 'aligned' ? 'CHAIR ALIGNED' : a === 'opposed' ? 'CHAIR OPPOSED' : 'CHAIR MIXED'
                const color = a === 'aligned' ? 'var(--teal)' : a === 'opposed' ? 'var(--danger)' : 'var(--gold)'
                const bg = a === 'aligned' ? 'rgba(184,151,90,0.08)' : a === 'opposed' ? 'rgba(196,71,48,0.06)' : 'rgba(255,201,74,0.06)'
                const border = a === 'aligned' ? 'rgba(184,151,90,0.2)' : a === 'opposed' ? 'rgba(196,71,48,0.2)' : 'rgba(255,201,74,0.15)'
                return (
                  <div title={`Chair Alignment: The committee chair ${a === 'aligned' ? 'shares' : 'does not share'} the prime sponsor's party. Aligned chairs are more likely to schedule hearings and move bills through committee.`} style={{
                    padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                    background: bg, color, border: `1px solid ${border}`, cursor: 'help',
                  }}>
                    {label}
                  </div>
                )
              })()}

              {/* Cross-Aisle Support badge */}
              {bill.cross_aisle_count > 0 && (
                <div title={`Cross-Aisle Support: ${bill.cross_aisle_count} co-sponsor${bill.cross_aisle_count !== 1 ? 's' : ''} from the opposing party. More cross-aisle support signals broader political viability.`} style={{
                  padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                  background: 'rgba(184,151,90,0.06)', color: 'var(--teal-mid)',
                  border: '1px solid rgba(184,151,90,0.15)', cursor: 'help',
                }}>
                  CROSS-AISLE · {bill.cross_aisle_count}
                </div>
              )}

              {/* Sponsor Track Record badge */}
              {bill.sponsor_track_record != null && (() => {
                const tr = bill.sponsor_track_record
                const pct = Math.round(tr * 100)
                const color = pct >= 30 ? 'var(--teal)' : pct >= 15 ? 'var(--gold)' : 'var(--text-faint)'
                const bg = pct >= 30 ? 'rgba(184,151,90,0.08)' : pct >= 15 ? 'rgba(255,201,74,0.06)' : 'rgba(100,120,140,0.06)'
                const border = pct >= 30 ? 'rgba(184,151,90,0.2)' : pct >= 15 ? 'rgba(255,201,74,0.15)' : 'rgba(100,120,140,0.15)'
                return (
                  <div title={`Sponsor Track Record: The prime sponsor's historical pass rate is ${pct}% across prior sessions. Higher rates indicate sponsors who consistently get bills signed into law.`} style={{
                    padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                    background: bg, color, border: `1px solid ${border}`, cursor: 'help',
                  }}>
                    TRACK RECORD · {pct}%
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* ── ACTIVITY TIMELINE (Phase 10.3) ─────────────── */}
        {(() => {
          // Build merged timeline from three sources
          const events = []

          // 1. Stage changes from snapshots (detect when stage changed between snapshots)
          const sortedSnaps = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
          for (let i = 1; i < sortedSnaps.length; i++) {
            if (sortedSnaps[i].stage !== sortedSnaps[i - 1].stage) {
              const stageLabel = PIPELINE_STAGES.find(p => p.num === sortedSnaps[i].stage)?.label || `Stage ${sortedSnaps[i].stage}`
              events.push({
                date: sortedSnaps[i].snapshot_date,
                type: 'stage',
                icon: '\u25B6',  // ▶
                color: 'var(--teal)',
                label: `Advanced to: ${stageLabel}`,
                detail: `Score: ${sortedSnaps[i].score}`,
              })
            }
          }

          // 2. Amendments
          for (const a of amendments) {
            const dateStr = a.floor_action_date || a.created_at?.split('T')[0] || ''
            events.push({
              date: dateStr,
              type: 'amendment',
              icon: '\u270E',  // ✎
              color: 'var(--gold)',
              label: `Amendment ${a.amendment_number || ''}${a.adopted ? ' — Adopted' : a.floor_action ? ` — ${a.floor_action}` : ''}`,
              detail: a.description || a.sponsor ? `${a.sponsor || ''}${a.description ? `: ${a.description.slice(0, 80)}` : ''}` : null,
              url: a.document_url,
            })
          }

          // 3. Fiscal note changes
          for (const f of fiscalHistory) {
            events.push({
              date: f.detected_date,
              type: 'fiscal',
              icon: '\u0024',  // $
              color: 'var(--danger, #c44730)',
              label: f.note || `Fiscal note: ${f.new_size}`,
              detail: [
                f.has_state_impact ? 'State impact' : null,
                f.has_local_impact ? 'Local impact' : null,
              ].filter(Boolean).join(' + ') || null,
            })
          }

          // Sort by date descending (most recent first)
          events.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

          if (events.length === 0) return null

          const visible = timelineExpanded ? events : events.slice(0, 5)
          const hasMore = events.length > 5

          return (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Activity Timeline
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  {events.length} event{events.length !== 1 ? 's' : ''}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {visible.map((ev, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 10, padding: '8px 0',
                    borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    {/* Date */}
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', minWidth: 72, flexShrink: 0, paddingTop: 2 }}>
                      {ev.date || '—'}
                    </div>
                    {/* Icon */}
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, flexShrink: 0,
                      background: `color-mix(in srgb, ${ev.color} 12%, transparent)`,
                      color: ev.color, border: `1px solid color-mix(in srgb, ${ev.color} 25%, transparent)`,
                    }}>
                      {ev.icon}
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {ev.url ? (
                          <a href={ev.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
                            {ev.label}
                          </a>
                        ) : ev.label}
                      </div>
                      {ev.detail && (
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                          {ev.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {hasMore && (
                <button
                  onClick={() => setTimelineExpanded(!timelineExpanded)}
                  style={{
                    width: '100%', marginTop: 8, padding: '6px 0',
                    background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {timelineExpanded ? 'Show less' : `Show all ${events.length} events`}
                </button>
              )}
            </div>
          )
        })()}

        {/* ── STAGE PIPELINE ─────────────────────────────── */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '14px 16px',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            Legislative Stage
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {PIPELINE_STAGES.map((ps, i) => {
              const done = ps.num < bill.stage
              const active = ps.num === bill.stage
              const dotColor = done ? 'var(--teal-dim)' : active ? 'var(--teal)' : 'var(--border)'
              const lineColor = done ? 'var(--teal-dim)' : 'var(--border)'
              const isLast = i === PIPELINE_STAGES.length - 1
              return (
                <div key={ps.num} style={{ display: 'flex', alignItems: 'center', flex: isLast ? 'none' : 1 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: active ? 11 : 7, height: active ? 11 : 7,
                      borderRadius: '50%', background: dotColor,
                      boxShadow: active ? 'var(--teal-glow)' : done ? '0 0 4px rgba(184,151,90,0.2)' : 'none',
                      animation: active ? 'dotPulse 2s ease-in-out infinite' : 'none',
                      transition: 'all 0.2s',
                    }}/>
                    <span style={{
                      fontSize: 7, color: active ? 'var(--teal)' : done ? 'var(--teal-dim)' : 'var(--text-faint)',
                      textAlign: 'center', whiteSpace: 'nowrap', fontWeight: active ? 600 : 400,
                    }}>{ps.label}</span>
                  </div>
                  {!isLast && <div style={{ flex: 1, height: 1, background: lineColor, margin: '0 2px', marginBottom: 14 }}/>}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── TABS ───────────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, overflowX: 'auto' }}>
            {[
              { key: 'trajectory', label: 'Trajectory' },
              { key: 'signals',    label: 'Signals' },
              { key: 'votes',      label: 'Votes' },
              { key: 'signal',     label: 'Signal Strength' },  // Phase 5C.6: renamed from "confidence"
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: '8px 14px', background: 'none', border: 'none',
                borderBottom: tab === key ? '2px solid var(--teal)' : '2px solid transparent',
                fontSize: 12, fontWeight: tab === key ? 600 : 400,
                color: tab === key ? 'var(--teal)' : 'var(--text-muted)',
                cursor: 'pointer',
                marginBottom: -1, flexShrink: 0,
                textShadow: tab === key ? '0 0 8px rgba(184,151,90,0.3)' : 'none',
                whiteSpace: 'nowrap',
              }}>{label}</button>
            ))}
          </div>

          {/* ── TRAJECTORY TAB ─────────────────────────── */}
          {tab === 'trajectory' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Score formula bar */}
              <div style={{
                background: 'linear-gradient(135deg, #0e1014 0%, #0a0c12 100%)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '12px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>BASE</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--text-mid)' }}>{baseTotal || '—'}</div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>×</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>X FACTOR</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--gold)' }}>{xfMult !== 1 ? `${Number(xfMult).toFixed(2)}×` : '1.00×'}</div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>=</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>FINAL</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 12px rgba(184,151,90,0.4)' }}>{score}</div>
                </div>
              </div>

              {/* Momentum index + Committee density */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px',
                }}>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Momentum Index</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 12px rgba(184,151,90,0.3)' }}>
                      {score}
                    </span>
                    {sparkScores.length > 1 && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: score > sparkScores[0] ? 'var(--teal)' : 'var(--danger)' }}>
                        {score > sparkScores[0] ? '+' : ''}{score - sparkScores[0]}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px',
                }}>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Committee Density</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32 }}>
                    {[
                      sig.committee_score || 0,
                      sig.sponsor_score || 0,
                      sig.momentum_score || 0,
                      sig.historical_score || 0,
                      sig.fiscal_score || 0,
                    ].map((val, i) => {
                      const maxH = 32
                      const maxVal = [25, 20, 20, 20, 15][i]
                      const h = maxVal > 0 ? Math.max(2, (val / maxVal) * maxH) : 2
                      const colors = ['var(--teal)', 'var(--teal-mid)', 'var(--gold)', 'var(--teal-dim)', 'var(--text-muted)']
                      return (
                        <div key={i} style={{
                          flex: 1, height: h,
                          background: colors[i],
                          borderRadius: '2px 2px 0 0',
                          boxShadow: val > 0 ? `0 0 6px ${colors[i]}40` : 'none',
                          transition: 'height 0.6s ease',
                        }}/>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 7, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 3, textAlign: 'center' }}>
                    Past rates for similar bills
                  </div>
                </div>
              </div>

              {/* Snapshot history */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px' }}>
                <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Score History · {sparkScores.length} snapshots
                </div>
                {snapshots.slice(-5).reverse().map((snap, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', width: 60 }}>
                      {new Date(snap.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${snap.score}%`, background: snap.score >= 50 ? 'var(--teal)' : snap.score >= 30 ? 'var(--gold)' : 'var(--text-muted)', borderRadius: 2, boxShadow: snap.score >= 50 ? '0 0 6px rgba(184,151,90,0.3)' : 'none' }}/>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: snap.score >= 50 ? 'var(--teal)' : 'var(--text-muted)', fontWeight: 600, width: 24, textAlign: 'right' }}>
                      {snap.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SIGNALS TAB ────────────────────────────── */}
          {tab === 'signals' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Committee', value: sig.committee_score || 0, max: 25, color: 'var(--teal)' },
                { label: 'Sponsor', value: sig.sponsor_score || 0, max: 20, color: 'var(--teal-mid)' },
                { label: 'Momentum', value: sig.momentum_score || 0, max: 20, color: 'var(--gold)' },
                { label: 'Historical', value: sig.historical_score || 0, max: 20, color: 'var(--teal-dim)' },
                { label: 'Fiscal', value: sig.fiscal_score || 0, max: 15, color: 'var(--text-muted)' },
              ].map(({ label, value, max, color }) => (
                <div key={label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color, fontWeight: 600, textShadow: value > 0 ? `0 0 6px ${color}40` : 'none' }}>
                      {value} / {max}
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(value / max) * 100}%`, background: color, borderRadius: 3, boxShadow: `0 0 8px ${color}40`, transition: 'width 0.6s ease' }}/>
                  </div>
                </div>
              ))}

              {latestSnap ? (
                <div style={{ padding: '12px 14px', background: 'var(--teal-pale)', border: '1px solid rgba(184,151,90,0.15)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--teal)', lineHeight: 1.5 }}>
                  {bill.pulled_from_rules
                    ? 'Pulled from Rules — strong floor advancement signal (+15%).'
                    : bill.held_in_rules
                    ? 'Held in Rules — 0.0% pass rate. Terminal signal.'
                    : bill.stalled
                    ? 'Stalled >21 days — terminal signal.'
                    : bill.committee_passed
                    ? 'Committee Do Pass received. Advancing trajectory.'
                    : bill.has_public_hearing
                    ? 'Hearing received. Committee vote needed to advance.'
                    : 'No hearing scheduled — 20.3% baseline pass rate.'}
                </div>
              ) : (
                <div style={{ padding: '12px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-muted)' }}>
                  Signal breakdown available after first sync cycle.
                </div>
              )}
            </div>
          )}

          {/* ── VOTES TAB ──────────────────────────────── */}
          {tab === 'votes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {floorMargin !== null ? (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
                    Floor Vote Margin
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 36, fontWeight: 800, color: scoreColor, textShadow: `0 0 16px ${scoreColor === 'var(--teal)' ? 'rgba(184,151,90,0.4)' : 'transparent'}` }}>
                      {floorMargin > 0 ? '+' : ''}{floorMargin}%
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>Average floor margin</div>
                      <div style={{ fontSize: 11, color: floorMargin > 10 ? 'var(--teal)' : floorMargin > 0 ? 'var(--gold)' : 'var(--danger)' }}>
                        {floorMargin >= 20 ? 'Strong Majority' : floorMargin >= 10 ? 'Solid Majority' : floorMargin >= 0 ? 'Narrow Majority' : 'Minority Vote'}
                      </div>
                    </div>
                  </div>
                  <div style={{ position: 'relative', height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute', left: '50%', top: 0, bottom: 0,
                      width: `${Math.abs(floorMargin) / 2}%`,
                      background: floorMargin >= 0 ? 'var(--teal)' : 'var(--danger)',
                      transform: floorMargin >= 0 ? 'none' : 'translateX(-100%)',
                      borderRadius: 4,
                      boxShadow: `0 0 8px ${floorMargin >= 0 ? 'rgba(184,151,90,0.3)' : 'rgba(196,71,48,0.3)'}`,
                    }}/>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.1)' }}/>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                    <span>Nay</span><span>50/50</span><span>Yea</span>
                  </div>
                  {bill.avg_floor_margin >= 0.1 && (
                    <div style={{
                      marginTop: 10, padding: '8px 12px',
                      background: 'var(--teal-pale)', border: '1px solid rgba(184,151,90,0.2)',
                      borderRadius: 8, fontSize: 11, color: 'var(--teal)',
                    }}>
                      ▲ Strong floor margin (+8% X Factor applied to trajectory score)
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 10, filter: 'grayscale(0.5)' }}>🗳️</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>No floor vote recorded yet</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    Floor vote data will appear here once the bill reaches the floor.
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Committee Vote', value: bill.committee_passed ? 'Do Pass' : 'Pending', color: bill.committee_passed ? 'var(--teal)' : 'var(--text-muted)' },
                  { label: 'Bipartisan', value: bill.bipartisan ? 'Yes' : 'Minority Only', color: bill.bipartisan ? 'var(--teal)' : 'var(--gold)' },
                  { label: 'Sponsor Tier', value: bill.sponsor_tier === 1 ? 'Leadership' : bill.sponsor_tier === 2 ? 'Senior' : 'Member', color: bill.sponsor_tier <= 2 ? 'var(--teal)' : 'var(--text-muted)' },
                  { label: 'Cosponsor Count', value: bill.cosponsor_count || 0, color: (bill.cosponsor_count || 0) >= 5 ? 'var(--teal)' : 'var(--text-muted)' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SIGNAL STRENGTH TAB (Phase 5C.6: renamed from "confidence") ─── */}
          {tab === 'signal' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Historical Pass Rate by Score
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                  How often bills in each score range became law, based on verified outcomes across three biennia (2,155 bills signed, 8,062 total).
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, fontWeight: 800, color: scoreColor, marginBottom: 4, textShadow: `0 0 20px ${scoreColor === 'var(--teal)' ? 'rgba(184,151,90,0.4)' : 'transparent'}` }}>
                  {getBucketLabel(score).rate}%
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  {getBucketLabel(score).label} · <span style={{ color: confColor }}>{confLabel}</span> signal
                </div>
                <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ height: '100%', width: `${Math.min(getBucketLabel(score).rate / 84.0 * 100, 100)}%`, background: scoreColor, borderRadius: 4, boxShadow: `0 0 10px ${scoreColor === 'var(--teal)' ? 'rgba(184,151,90,0.3)' : 'transparent'}`, transition: 'width 0.4s ease' }}/>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  <span>0%</span><span>42%</span><span>84%</span>
                </div>
              </div>

              {[
                { range: '0–30', rate: '0.0%', pct: 0 },
                { range: '30–45', rate: '0.0%', pct: 0 },
                { range: '45–60', rate: '0.0%', pct: 0 },
                { range: '60–75', rate: '1.8%', pct: 1.8 },
                { range: '75–100', rate: '84.0%', pct: 84.0 },
              ].map(({ range, rate, pct }) => {
                const isCurrentBucket =
                  (range === '0–30' && score < 30) || (range === '30–45' && score >= 30 && score < 45) ||
                  (range === '45–60' && score >= 45 && score < 60) || (range === '60–75' && score >= 60 && score < 75) ||
                  (range === '75–100' && score >= 75)
                return (
                  <div key={range} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: isCurrentBucket ? 'var(--teal-pale)' : 'var(--bg-card)',
                    border: `1px solid ${isCurrentBucket ? 'rgba(184,151,90,0.2)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', padding: '8px 12px',
                    boxShadow: isCurrentBucket ? '0 0 12px rgba(184,151,90,0.1)' : 'none',
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: isCurrentBucket ? 'var(--teal)' : 'var(--text-muted)', width: 48, fontWeight: isCurrentBucket ? 600 : 400 }}>{range}</span>
                    <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(pct / 84.0 * 100, pct > 0 ? 3 : 0)}%`, background: isCurrentBucket ? 'var(--teal)' : 'var(--teal-dim)', borderRadius: 2, boxShadow: isCurrentBucket ? '0 0 6px rgba(184,151,90,0.3)' : 'none' }}/>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: isCurrentBucket ? 'var(--teal)' : 'var(--text-muted)', width: 36, textAlign: 'right', fontWeight: isCurrentBucket ? 700 : 400 }}>{rate}</span>
                    {isCurrentBucket && <span style={{ fontSize: 10, color: 'var(--teal)' }}>◀</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── NOTES (Phase 7S: Analyst Intelligence Notes) ── */}
        {tracked && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
              Analyst Notes
            </div>
            {/* Client tag */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Client</label>
              <input type="text" value={clientTag} onChange={e => setClientTag(e.target.value)}
                placeholder="e.g. JBLM, Housing Coalition..."
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
              />
              <button onClick={saveNotes} disabled={saving} style={{
                marginTop: 6, padding: '5px 14px', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Saving...' : 'Save Client'}</button>
            </div>
            {/* New note form */}
            <div style={{ marginBottom: 14 }}>
              <textarea
                value={noteBody}
                onChange={e => setNoteBody(e.target.value)}
                placeholder="Intelligence note — who you talked to, what the chair signaled, strategy..."
                rows={3}
                style={{
                  width: '100%', padding: '8px 12px', background: 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  fontSize: 13, color: 'var(--text-primary)', outline: 'none',
                  resize: 'vertical', lineHeight: 1.5,
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                {/* Visibility toggle */}
                <div style={{
                  display: 'flex', borderRadius: 8, overflow: 'hidden',
                  border: '1px solid var(--border)',
                }}>
                  {['internal', 'client'].map(v => (
                    <button key={v} onClick={() => setNoteVis(v)} style={{
                      padding: '5px 12px', border: 'none', fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'var(--font-mono)',
                      letterSpacing: '0.05em', textTransform: 'uppercase',
                      background: noteVis === v
                        ? (v === 'internal' ? 'rgba(138,128,112,0.15)' : 'rgba(184,151,90,0.15)')
                        : 'transparent',
                      color: noteVis === v
                        ? (v === 'internal' ? 'var(--text-muted)' : 'var(--gold)')
                        : 'var(--text-faint)',
                      transition: 'all 0.15s',
                    }}>{v}</button>
                  ))}
                </div>
                <div style={{ flex: 1 }}/>
                {editingNoteId && (
                  <button onClick={cancelEditNote} style={{
                    padding: '7px 14px', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 8,
                    fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer',
                  }}>Cancel</button>
                )}
                <button onClick={saveNote} disabled={savingNote || !noteBody.trim()} style={{
                  padding: '7px 18px',
                  background: noteVis === 'client' ? 'var(--gold)' : 'var(--teal)',
                  color: 'var(--bg)', border: 'none', borderRadius: 8,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  opacity: (savingNote || !noteBody.trim()) ? 0.5 : 1,
                  boxShadow: noteVis === 'client' ? 'var(--gold-glow)' : 'var(--teal-glow)',
                  transition: 'all 0.15s',
                }}>
                  {savingNote ? 'Saving...' : editingNoteId ? 'Update Note' : 'Add Note'}
                </button>
              </div>
            </div>
            {/* Notes list */}
            {billNotes.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '12px 0' }}>
                No analyst notes yet. Add your first note above.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {billNotes.map(note => (
                  <div key={note.id} style={{
                    padding: '10px 12px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${note.visibility === 'client' ? 'var(--gold)' : 'rgba(138,128,112,0.4)'}`,
                    borderRadius: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 9, padding: '2px 7px', borderRadius: 8,
                        fontFamily: 'var(--font-mono)', fontWeight: 600,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        background: note.visibility === 'client' ? 'rgba(184,151,90,0.12)' : 'rgba(138,128,112,0.12)',
                        color: note.visibility === 'client' ? 'var(--gold)' : 'var(--text-muted)',
                        border: `1px solid ${note.visibility === 'client' ? 'rgba(184,151,90,0.25)' : 'rgba(138,128,112,0.2)'}`,
                      }}>{note.visibility}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                        {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {note.updated_at !== note.created_at && ' (edited)'}
                      </span>
                      <div style={{ flex: 1 }}/>
                      <button onClick={(e) => { e.stopPropagation(); startEditNote(note) }} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                        color: 'var(--text-faint)', fontSize: 11, transition: 'color 0.15s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--teal)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteNote(note.id) }} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                        color: 'var(--text-faint)', fontSize: 11, transition: 'color 0.15s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {note.body}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <Nav/>
    </div>
  )
}
