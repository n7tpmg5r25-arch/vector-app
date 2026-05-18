'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { isInterimPeriod, getCurrentSession } from '../../lib/session-config'
import { fetchTotalScoredBills } from '../../lib/app-stats'
import { useSession } from '../../lib/useSession'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'
import MeetingBadge from '../components/MeetingBadge'
import VectorLoader from '../components/VectorLoader'
import SwipeableRow from '../components/SwipeableRow'
import { Check, Bookmark, Clipboard } from 'lucide-react'

import { STAGE_SHORT } from '../../lib/stages'
export default function WatchlistPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  // Phase 7U.5: track the currently-viewed biennium so the watchlist mirrors
  // the home page session picker. Watches remain global in tracked_bills; we
  // filter to the active session client-side after the join.
  const [SESSION] = useSession()
  const { user, capabilities, loading: viewerLoading } = useViewer()
  const [watched, setWatched]               = useState([])
  const [tags, setTags]                     = useState([])
  const [activeTag, setActiveTag]           = useState('All')
  const [sortBy, setSortBy]                 = useState('score')
  const [atRiskOnly, setAtRiskOnly]         = useState(false)
  const [scoreDeltas, setScoreDeltas]       = useState({})
  const [changes, setChanges]               = useState({})
  const [changesDismissed, setChangesDismissed] = useState(false)
  const [loading, setLoading]               = useState(true)
  const [exporting, setExporting]           = useState(false)
  // Calendar subscribe state
  const [calCopied, setCalCopied]           = useState(false)
  // Thread 102: swipe actions — highlight for report + remove
  const [highlighted, setHighlighted]       = useState(new Set())
  const [openSwipeId, setOpenSwipeId]       = useState(null)
  // Thread 104: batched meeting lookup — keyed by bill_id, built in load()
  const [meetingByBill, setMeetingByBill]   = useState({})
  // Phase 7S: quick-note state
  const [notesBillId, setNotesBillId]       = useState(null)
  const [quickNote, setQuickNote]           = useState('')
  const [savingQuickNote, setSavingQuickNote] = useState(false)
  const [billNoteMeta, setBillNoteMeta]     = useState({})

  useEffect(() => {
    if (viewerLoading) return
    async function load() {
      if (!user) return

      /* ── 1. Fetch tracked bills (now includes last_viewed_at) ── */
      const { data } = await supabase
        .from('tracked_bills')
        .select(`
          bill_id, tag, notes, added_at, last_viewed_at,
          bills (
            bill_id, bill_number, title, final_score,
            stage, chamber, category, committee_name,
            has_public_hearing, committee_passed,
            hearing_date, days_to_cutoff, status, stalled,
            prime_sponsor, prime_party, bipartisan,
            session, companion_bill, confidence_label, pass_probability, ai_summary,
            bipartisan_index, chair_alignment, cross_aisle_count, sponsor_track_record,
            calendar_pressure, calendar_pressure_next_meeting
          )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

      // Phase 7U.5: filter to the currently-viewed biennium. When the user
      // switches sessions via the session picker, this page re-runs load()
      // because SESSION is a dep of the useEffect below.
      const items = (data || []).filter(d => d.bills && d.bills.session === SESSION)
      setWatched(items)

      const allTags = [...new Set(items.map(d => d.tag).filter(Boolean))]
      setTags(allTags)

      /* ── 2. Find earliest last_viewed_at (they should all match) ── */
      const lastViewed = items.reduce((earliest, d) => {
        if (!d.last_viewed_at) return earliest
        if (!earliest) return d.last_viewed_at
        return d.last_viewed_at < earliest ? d.last_viewed_at : earliest
      }, null)

      /* ── 3 & 4. Phase 6.4 perf: Fetch snapshots + update last_viewed_at in parallel ── */
      /* ── Thread 104: also batch all MeetingBadge queries into one ── */
      const billIds = items.map(d => d.bill_id)
      const today = new Date().toISOString().split('T')[0]
      const [snapsResult, , agendaResult] = await Promise.all([
        billIds.length > 0
          ? supabase
              .from('trajectory_snapshots')
              .select('bill_id, score, stage, snapshot_date')
              .in('bill_id', billIds)
              .order('snapshot_date', { ascending: false })
          : Promise.resolve({ data: null }),
        supabase
          .from('tracked_bills')
          .update({ last_viewed_at: new Date().toISOString() })
          .eq('user_id', user.id),
        billIds.length > 0
          ? supabase
              .from('meeting_agenda_items')
              .select('bill_id, committee_meetings!inner(id, committee_name, chamber, meeting_date, meeting_time, is_joint, committees!inner(slug))')
              .in('bill_id', billIds)
              .gte('committee_meetings.meeting_date', today)
          : Promise.resolve({ data: null }),
      ])

      // Thread 104: build earliest-meeting-per-bill map for MeetingBadge props
      const meetingMap = {}
      ;(agendaResult?.data || []).forEach(item => {
        const cm = item.committee_meetings
        const existing = meetingMap[item.bill_id]
        if (!existing || cm.meeting_date < existing.meeting_date) {
          meetingMap[item.bill_id] = { ...cm, slug: cm.committees?.slug }
        }
      })
      setMeetingByBill(meetingMap)

      const snaps = snapsResult.data
      if (snaps) {
        const byBill = {}
        snaps.forEach(s => {
          if (!byBill[s.bill_id]) byBill[s.bill_id] = []
          byBill[s.bill_id].push(s)
        })

        // Score deltas: latest vs previous snapshot
        const deltas = {}
        Object.entries(byBill).forEach(([bid, arr]) => {
          if (arr.length >= 2) {
            deltas[bid] = (arr[0].score || 0) - (arr[1].score || 0)
          }
        })
        setScoreDeltas(deltas)

        // Change detection: latest vs snapshot at last_viewed_at
        if (lastViewed) {
          const lastViewedDate = lastViewed.slice(0, 10) // YYYY-MM-DD
          const detected = {}

          Object.entries(byBill).forEach(([bid, arr]) => {
            const latest = arr[0]
            const oldSnap = arr.find(s => s.snapshot_date <= lastViewedDate)

            if (oldSnap && latest && latest.snapshot_date !== oldSnap.snapshot_date) {
              const scoreDiff = (latest.score || 0) - (oldSnap.score || 0)
              const stageChanged = latest.stage !== oldSnap.stage

              if (scoreDiff !== 0 || stageChanged) {
                detected[bid] = {
                  oldScore: oldSnap.score,
                  newScore: latest.score,
                  scoreDiff,
                  oldStage: oldSnap.stage,
                  newStage: latest.stage,
                  stageChanged,
                }
              }
            }
          })
          setChanges(detected)
        }
      }

      // Phase 7S: fetch note counts per bill
      if (billIds.length > 0) {
        const { data: allNotes } = await supabase
          .from('bill_notes')
          .select('bill_id, created_at, updated_at')
          .eq('user_id', user.id)
          .in('bill_id', billIds)
          .order('updated_at', { ascending: false })
        if (allNotes) {
          const meta = {}
          allNotes.forEach(n => {
            if (!meta[n.bill_id]) {
              meta[n.bill_id] = { count: 0, lastUpdated: n.updated_at }
            }
            meta[n.bill_id].count++
          })
          setBillNoteMeta(meta)
        }
      }

      setLoading(false)
    }
    load()
  }, [SESSION, user?.id, viewerLoading])

  /* ── Filtering & sorting ── */
  const tagFiltered = activeTag === 'All'
    ? watched
    : watched.filter(d => d.tag === activeTag)
  const filtered = atRiskOnly
    ? (isInterimPeriod()
      ? tagFiltered.filter(d => d.bills?.confidence_label === 'DEAD')
      : tagFiltered.filter(d => (d.bills?.final_score || 0) < 25 || d.bills?.stalled))
    : tagFiltered

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'score') return (b.bills?.final_score || 0) - (a.bills?.final_score || 0)
    if (sortBy === 'added') return new Date(b.added_at) - new Date(a.added_at)
    if (sortBy === 'name') return (a.bills?.title || '').localeCompare(b.bills?.title || '')
    return 0
  })

  const scores = filtered.map(d => d.bills?.final_score ?? 0).filter(s => s != null)
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  const highCount = filtered.filter(d => (d.bills?.final_score || 0) >= 50).length
  const hearingCount = filtered.filter(d => d.bills?.has_public_hearing).length
  // Thread 96: KPI card header — computed from full session watchlist (not tag/risk filter)
  const highScoreCount = watched.filter(d => (d.bills?.final_score || 0) >= 50).length
  const atRiskCount = watched.filter(d => !d.bills?.confidence_label && ((d.bills?.final_score || 0) < 25 || d.bills?.stalled)).length
  const passedCount = watched.filter(d => d.bills?.confidence_label === 'LAW').length
  const deadCount = watched.filter(d => d.bills?.confidence_label === 'DEAD').length

  /* ── PDF Export handler ── */
  const handleExport = async () => {
    setExporting(true)
    try {
      const { generateBriefPDF } = await import('../../lib/generate-pdf')
      const tagLabel = activeTag !== 'All' ? activeTag : null
      // Thread 102: export only highlighted bills when any are selected
      const billsToExport = highlighted.size > 0
        ? sorted.filter(d => highlighted.has(d.bill_id))
        : sorted
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

      // Phase 7S: fetch shared (export-visible) analyst notes for all tracked bills
      // (user comes from useViewer() hook closure)
      let billNotes = []
      if (user) {
        const billIds = billsToExport.map(d => d.bill_id)
        if (billIds.length > 0) {
          const { data: notesData } = await supabase
            .from('bill_notes')
            .select('*')
            .eq('user_id', user.id)
            .eq('visibility', 'shared')
            .in('bill_id', billIds)
            .order('created_at', { ascending: false })
          billNotes = notesData || []
        }
      }

      // Phase 10.5: fetch amendments and fiscal note history for activity line
      const billIds = billsToExport.map(d => d.bill_id)
      let amendmentsData = []
      let fiscalData = []
      if (billIds.length > 0) {
        const { data: aData } = await supabase
          .from('amendments')
          .select('bill_id, amendment_number, adopted, floor_action_date')
          .in('bill_id', billIds)
        amendmentsData = aData || []

        const { data: fData } = await supabase
          .from('fiscal_note_history')
          .select('bill_id, detected_date, new_size, note')
          .in('bill_id', billIds)
        fiscalData = fData || []
      }

      const sessionLabel = getCurrentSession() + (isInterimPeriod() ? ' (Interim)' : '')

      // DATA_FRESHNESS #22: live cohort count for calibration blurb
      // (replaces hardcoded "8,062 / 3 biennia / 2021-2026" in generate-pdf.js)
      let cohortStats = null
      try {
        cohortStats = await fetchTotalScoredBills(supabase)
      } catch (e) {
        // If the live query fails generate-pdf.js falls back to the baked-in sentence.
        console.warn('cohort count fetch failed; PDF will use fallback blurb', e)
      }

      await generateBriefPDF({
        tagLabel,
        date: today,
        bills: billsToExport,
        scoreDeltas,
        changes,
        session: sessionLabel,
        billNotes,
        amendments: amendmentsData,
        fiscalHistory: fiscalData,
        cohortStats,
      })
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('PDF export failed. Make sure jspdf is installed (npm install jspdf jspdf-autotable).')
    }
    setExporting(false)
  }

  /* ── Thread 102: Remove bill from watchlist (swipe action) ── */
  const handleRemove = async (billId) => {
    // Optimistic: remove from local state first, then delete from DB
    setWatched(prev => prev.filter(w => w.bill_id !== billId))
    setHighlighted(prev => { const n = new Set(prev); n.delete(billId); return n })
    setOpenSwipeId(null)
    await supabase.from('tracked_bills').delete().eq('bill_id', billId)
  }

  /* ── Thread 102: Toggle highlight for PDF report (swipe action) ── */
  const toggleHighlight = (billId) => {
    setHighlighted(prev => {
      const n = new Set(prev)
      n.has(billId) ? n.delete(billId) : n.add(billId)
      return n
    })
    setOpenSwipeId(null) // snap card closed after toggling
  }

  /* ── Phase 7S: quick-note save handler ── */
  const saveQuickNote = async () => {
    if (!notesBillId || !quickNote.trim()) return
    setSavingQuickNote(true)
    // (user comes from useViewer() hook closure)
    if (user) {
      const { data } = await supabase
        .from('bill_notes')
        .insert({ bill_id: notesBillId, user_id: user.id, body: quickNote.trim(), visibility: 'private' })
        .select()
        .single()
      if (data) {
        setBillNoteMeta(prev => ({
          ...prev,
          [notesBillId]: {
            count: (prev[notesBillId]?.count || 0) + 1,
            lastUpdated: data.updated_at,
          }
        }))
      }
    }
    setQuickNote('')
    setNotesBillId(null)
    setSavingQuickNote(false)
  }

  /* ── Which bills have changes (filtered to current view) ── */
  const changedBills = sorted.filter(d => changes[d.bill_id])
  const showChanges = !changesDismissed && changedBills.length > 0

  return (
    <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>
      {/* ━━━ HEADER ━━━ */}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>
            Watchlist
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Subscribe to Calendar — direct webcal:// link */}
            {filtered.length > 0 && (
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault()
                  const { data: { session: sess } } = await supabase.auth.getSession()
                  if (!sess?.access_token) { alert('Please log in to subscribe.'); return }
                  const base = window.location.origin
                  window.location.href = `webcal://${base.replace(/^https?:\/\//, '')}/api/calendar/watchlist.ics?token=${sess.access_token}`
                }}
                style={{
                  padding: '4px 12px', borderRadius: 14, fontSize: 10, fontWeight: 600,
                  background: 'transparent', color: 'var(--gold)',
                  border: '1px solid rgba(184,151,90,0.35)',
                  cursor: 'pointer', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontFamily: 'var(--font-mono)', textDecoration: 'none',
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Subscribe
              </a>
            )}
            {/* Export Report button */}
            {filtered.length > 0 && (
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{
                  padding: '4px 12px', borderRadius: 14, fontSize: 10, fontWeight: 600,
                  background: 'transparent',
                  color: 'var(--gold)',
                  border: '1px solid rgba(184,151,90,0.35)',
                  cursor: exporting ? 'wait' : 'pointer',
                  transition: 'all 0.15s',
                  opacity: exporting ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/>
                </svg>
                {exporting ? 'Generating...' : highlighted.size > 0 ? `Export selected (${highlighted.size})` : 'Export PDF'}
              </button>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {filtered.length} bills
            </div>
          </div>
        </div>

        {/* Thread 96: KPI card strip — 3-col card grid matching home page personal zone */}
        {watched.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            {(isInterimPeriod() ? [
              { label: 'Tracked',    value: watched.length, color: 'var(--teal)' },
              { label: 'Passed',     value: passedCount, color: passedCount > 0 ? 'var(--teal)' : 'var(--text-muted)' },
              { label: 'Dead',       value: deadCount, color: 'var(--text-muted)' },
            ] : [
              { label: 'Tracked',    value: watched.length, color: 'var(--teal)' },
              { label: 'High Score', value: highScoreCount, color: highScoreCount > 0 ? 'var(--teal-bright)' : 'var(--text-muted)' },
              { label: 'At Risk',    value: atRiskCount, color: atRiskCount > 0 ? 'var(--danger)' : 'var(--text-muted)' },
            ]).map(({ label, value, color }) => (
              <div key={label} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '10px 12px', textAlign: 'center',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, lineHeight: 1, textShadow: color === 'var(--teal)' ? '0 0 12px rgba(184,151,90,0.3)' : color === 'var(--danger)' ? '0 0 12px rgba(196,71,48,0.3)' : 'transparent' }}>
                  {value}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        )}

        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
            {['All', ...tags].map(c => (
              <button key={c} onClick={() => setActiveTag(c)} style={{
                padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
                background: activeTag === c ? 'var(--teal)' : 'transparent',
                color: activeTag === c ? 'var(--bg)' : 'var(--text-muted)',
                border: `1px solid ${activeTag === c ? 'var(--teal)' : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: activeTag === c ? 'var(--teal-glow)' : 'none',
              }}>{c}</button>
            ))}
          </div>
        )}

        {filtered.length > 1 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[['score', 'By Score'], ['added', 'Recently Added'], ['name', 'A\u2013Z']].map(([val, label]) => (
              <button key={val} onClick={() => setSortBy(val)} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 10, flexShrink: 0,
                background: sortBy === val ? 'var(--bg-surface)' : 'transparent',
                color: sortBy === val ? 'var(--text-primary)' : 'var(--text-faint)',
                border: `1px solid ${sortBy === val ? 'var(--border)' : 'transparent'}`,
                cursor: 'pointer',
              }}>{label}</button>
            ))}
            <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }}/>
            <button onClick={() => setAtRiskOnly(!atRiskOnly)} style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 10, flexShrink: 0,
              background: atRiskOnly ? 'var(--danger-pale)' : 'transparent',
              color: atRiskOnly ? 'var(--danger)' : 'var(--text-faint)',
              border: `1px solid ${atRiskOnly ? 'rgba(196,71,48,0.3)' : 'transparent'}`,
              cursor: 'pointer', fontWeight: atRiskOnly ? 600 : 400,
              boxShadow: atRiskOnly ? 'var(--danger-glow)' : 'none',
            }}>{isInterimPeriod() ? "Didn\u2019t Pass" : '\u26A0 At Risk'}</button>
          </div>
        )}

        {/* Thread 102: selected-for-report counter strip */}
        {highlighted.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--brass, #b8975a)',
          }}>
            <span>\u25CF {highlighted.size} selected for report</span>
            <button
              onClick={() => setHighlighted(new Set())}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'var(--font-mono)',
              }}
            >Clear</button>
          </div>
        )}
      </div>

      {/* ━━━ CONTENT ━━━ */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>

        {/* ── WHAT'S CHANGED SECTION ── */}
        {!loading && !isInterimPeriod() && showChanges && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(184,151,90,0.06), rgba(184,151,90,0.02))',
            border: '1px solid rgba(184,151,90,0.2)',
            borderRadius: 'var(--radius)',
            padding: '14px 16px',
            marginBottom: 4,
            animation: 'fadeUp 0.3s ease both',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600,
                color: 'var(--teal)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', boxShadow: '0 0 6px rgba(184,151,90,0.5)', display: 'inline-block' }}/>
                What's Changed
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-body)', fontWeight: 400 }}>
                  since your last visit
                </span>
              </div>
              <button
                onClick={() => setChangesDismissed(true)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-faint)',
                  cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1,
                }}
                aria-label="Dismiss changes"
              >{'×'}</button>
            </div>

            {changedBills.map(({ bill_id, bills: bill }) => {
              const change = changes[bill_id]
              return (
                <Link
                  key={bill_id}
                  href={`/bill/${bill.bill_id}`}
                  prefetch={false}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                    borderTop: '1px solid rgba(184,151,90,0.08)',
                    cursor: 'pointer',
                    textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
                    minWidth: 56, fontWeight: 500,
                  }}>
                    {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    <MeetingBadge billId={bill.bill_id} meeting={meetingByBill[bill_id] || null} compact />
                  </span>
                  <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {change.scoreDiff !== 0 && (
                      <span style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                        padding: '2px 8px', borderRadius: 10,
                        background: change.scoreDiff > 0 ? 'rgba(184,151,90,0.12)' : 'rgba(196,71,48,0.12)',
                        color: change.scoreDiff > 0 ? 'var(--teal)' : 'var(--danger)',
                        border: `1px solid ${change.scoreDiff > 0 ? 'rgba(184,151,90,0.25)' : 'rgba(196,71,48,0.25)'}`,
                      }}>
                        Score {change.oldScore} {'→'}{change.newScore} ({change.scoreDiff > 0 ? '+' : ''}{change.scoreDiff})
                      </span>
                    )}
                    {change.stageChanged && (
                      <span style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                        padding: '2px 8px', borderRadius: 10,
                        background: change.newStage > change.oldStage ? 'rgba(184,151,90,0.12)' : 'rgba(196,71,48,0.12)',
                        color: change.newStage > change.oldStage ? 'var(--teal)' : 'var(--danger)',
                        border: `1px solid ${change.newStage > change.oldStage ? 'rgba(184,151,90,0.25)' : 'rgba(196,71,48,0.25)'}`,
                      }}>
                        Stage {STAGE_SHORT[change.oldStage] || '?'} {'→'}{STAGE_SHORT[change.newStage] || '?'}
                      </span>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* ── BILL CARDS ── */}
        {/* Thread 7: desktop-only column-header strip. Mobile renders
            display:none so the existing card stack is unchanged. */}
        {loading ? (
          <VectorLoader label="Loading watchlist" />
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', marginBottom: 16, color: 'var(--text-faint)', opacity: 0.6 }}>
              <Clipboard size={32} aria-hidden="true" strokeWidth={1.5} />
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--teal)', marginBottom: 8, fontWeight: 600 }}>
              No bills tracked yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Search bills and tap + Watch to add them here.
            </div>
            <button onClick={() => router.push('/search')} className="vec-cta-primary" style={{
              padding: '10px 24px', background: 'var(--teal)', color: 'var(--bg)',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}>Browse Bills</button>
          </div>
        ) : sorted.map(({ bill_id, tag, notes, bills: bill }, idx) => {
          const delta = scoreDeltas[bill_id]
          const hasChange = changes[bill_id]
          return (
          <SwipeableRow
            key={bill_id}
            isHighlighted={highlighted.has(bill_id)}
            isOpen={openSwipeId === bill_id}
            onOpen={() => setOpenSwipeId(bill_id)}
            onClose={() => setOpenSwipeId(null)}
            onHighlight={() => toggleHighlight(bill_id)}
            onRemove={() => handleRemove(bill_id)}
          >
          <Link
            href={`/bill/${bill.bill_id}`}
            prefetch={false}
            style={{
              display: 'block',
              position: 'relative',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px',
              cursor: 'pointer', transition: 'border-color 0.2s',
              borderLeft: highlighted.has(bill_id) ? '3px solid var(--brass, #b8975a)'
                : bill.confidence_label === 'DEAD' ? '3px solid var(--border)'
                : bill.confidence_label === 'LAW' ? '3px solid var(--teal)'
                : bill.confidence_label === 'PASSED_CHAMBER' ? '3px solid var(--gold)'
                : bill.stalled ? '3px solid var(--danger)'
                : (bill.final_score >= 50 ? '3px solid var(--teal)' : '1px solid var(--border)'),
              animation: `fadeUp 0.3s ease ${idx * 0.03}s both`,
              textDecoration: 'none', color: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            {/* Thread 102: FOR REPORT pip — shown when bill is highlighted */}
            {highlighted.has(bill_id) && (
              <span style={{
                position: 'absolute', top: 6, right: 8,
                fontSize: 7, color: 'var(--brass, #b8975a)',
                fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>FOR REPORT</span>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <ScoreBadge score={bill.final_score} size="md" status={bill.confidence_label}/>
                {!isInterimPeriod() && delta != null && delta !== 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -10,
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '1px 5px', borderRadius: 8,
                    background: delta > 0 ? 'rgba(184,151,90,0.15)' : 'rgba(196,71,48,0.15)',
                    color: delta > 0 ? 'var(--teal)' : 'var(--danger)',
                    border: `1px solid ${delta > 0 ? 'rgba(184,151,90,0.3)' : 'rgba(196,71,48,0.3)'}`,
                    whiteSpace: 'nowrap',
                  }}>
                    {delta > 0 ? '+' : ''}{delta}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500 }}>
                    {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    <MeetingBadge billId={bill.bill_id} meeting={meetingByBill[bill_id] || null} compact />
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {STAGE_SHORT[bill.stage] || 'Intro'}
                  </span>
                  {tag && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 10, fontWeight: 500 }}>
                      {tag}
                    </span>
                  )}
                  {bill.confidence_label === 'LAW' && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--teal-pale)', color: 'var(--teal)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 10, fontWeight: 500 }}>
                      Signed into Law
                    </span>
                  )}
                  {bill.confidence_label === 'PASSED_CHAMBER' && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 10, fontWeight: 500 }}>
                      Passed Chamber
                    </span>
                  )}
                  {bill.confidence_label === 'DEAD' && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'rgba(255,255,255,0.04)', color: 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 10 }}>
                      Dead
                    </span>
                  )}
                  {bill.stalled && !bill.confidence_label && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--danger-pale)', color: 'var(--danger)', border: '1px solid rgba(196,71,48,0.25)', borderRadius: 10 }}>
                      Stalled
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 6 }}>
                  {bill.title || bill.committee_name || 'Bill ' + bill.bill_number}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {bill.has_public_hearing && (
                    <span style={{ fontSize: 9, color: 'var(--teal-mid)', fontFamily: 'var(--font-mono)' }}>HEARING</span>
                  )}
                  {bill.committee_passed && (
                    <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={9} aria-hidden="true" strokeWidth={3} /> CMTE PASS</span>
                  )}
                  {!bill.bipartisan && (
                    <span style={{ fontSize: 9, color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>Minority Only</span>
                  )}
                  {/* Phase 8: Dynamics headline */}
                  {bill.bipartisan_index > 0.3 && (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--teal)', fontWeight: 500, padding: '1px 6px', borderRadius: 8, background: 'rgba(184,151,90,0.08)', border: '1px solid rgba(184,151,90,0.2)' }}>Bipartisan</span>
                  )}
                  {bill.chair_alignment === 'aligned' && (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--teal-mid)', fontWeight: 500, padding: '1px 6px', borderRadius: 8, background: 'rgba(184,151,90,0.06)', border: '1px solid rgba(184,151,90,0.15)' }}>Chair-backed</span>
                  )}
                  {bill.chair_alignment === 'opposed' && (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--danger)', fontWeight: 500, padding: '1px 6px', borderRadius: 8, background: 'rgba(196,71,48,0.06)', border: '1px solid rgba(196,71,48,0.15)' }}>Chair-blocked</span>
                  )}
                  {/* Phase 11.5: Calendar pressure — display-only, threshold 20 */}
                  {bill.calendar_pressure != null && bill.calendar_pressure >= 20 && bill.calendar_pressure_next_meeting && (() => {
                    const next = new Date(bill.calendar_pressure_next_meeting + 'T00:00:00')
                    const daysOut = Math.round((next - new Date()) / (1000 * 60 * 60 * 24))
                    if (daysOut < 0 || daysOut > 7) return null
                    const nextLabel = next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    return (
                      <span
                        title={`${bill.calendar_pressure} agenda items across ${bill.committee_name || 'the committee'}'s scheduled meetings in the next 7 days. Next meeting: ${nextLabel}.`}
                        style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--gold)', fontWeight: 500, padding: '1px 6px', borderRadius: 8, background: 'rgba(196,122,48,0.08)', border: '1px solid rgba(196,122,48,0.25)', cursor: 'help' }}
                      >
                        ◐ Crowded docket · {bill.calendar_pressure}
                      </span>
                    )
                  })()}
                </div>
                {notes && (
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
                    marginTop: 6, lineHeight: 1.4,
                    borderLeft: '2px solid var(--border)', paddingLeft: 8,
                  }}>{notes}</div>
                )}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700,
                color: bill.final_score != null ? 'var(--brass)' : 'var(--text-faint)',
                minWidth: 36, textAlign: 'right', flexShrink: 0, alignSelf: 'center',
              }}>
                {bill.final_score != null ? bill.final_score : '—'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div style={{ display: 'inline-flex', color: 'var(--gold)', filter: 'drop-shadow(0 0 4px rgba(184,151,90,0.3))' }}>
                  <Bookmark size={14} aria-hidden="true" fill="currentColor" />
                </div>
                {/* Phase 7S: quick-note pencil icon */}
                <button
                  onClick={e => { e.stopPropagation(); setNotesBillId(notesBillId === bill_id ? null : bill_id); setQuickNote('') }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                    color: notesBillId === bill_id ? 'var(--teal)' : 'var(--text-faint)',
                    opacity: notesBillId === bill_id ? 1 : 0.5, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => { if (notesBillId !== bill_id) e.currentTarget.style.opacity = '0.5' }}
                  title="Quick note"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                {billNoteMeta[bill_id] && (
                  <span style={{
                    fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)',
                    textAlign: 'center', lineHeight: 1.2,
                  }}>
                    {billNoteMeta[bill_id].count} note{billNoteMeta[bill_id].count !== 1 ? 's' : ''}
                  </span>
                )}
                <button
                  type="button"
                  onClick={e => {
                    e.preventDefault(); e.stopPropagation()
                    // Thread 7 (G4): drop the literal '2025-2026' fallback in favor
                    // of getCurrentSession() so the leg.wa.gov bill-summary deep link
                    // auto-rolls when sessions change.
                    const url = `https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${(bill.session || getCurrentSession()).split('-')[0]}`
                    window.open(url, '_blank', 'noopener,noreferrer')
                  }}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-faint)', opacity: 0.5, transition: 'opacity 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                  title="View on leg.wa.gov"
                  aria-label={`Open ${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number} on leg.wa.gov`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Phase 7S: inline quick-note editor */}
            {notesBillId === bill_id && (
              <div onClick={e => e.stopPropagation()} style={{
                marginTop: 10, padding: '10px 12px',
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8,
              }}>
                <textarea
                  value={quickNote}
                  onChange={e => setQuickNote(e.target.value)}
                  placeholder="Quick internal note..."
                  rows={2}
                  autoFocus
                  style={{
                    width: '100%', padding: '6px 10px', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 6,
                    fontSize: 12, color: 'var(--text-primary)', outline: 'none',
                    resize: 'vertical', lineHeight: 1.5,
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)',
                    letterSpacing: '0.05em', textTransform: 'uppercase',
                    padding: '2px 8px', background: 'rgba(138,128,112,0.12)',
                    borderRadius: 6, border: '1px solid rgba(138,128,112,0.2)',
                  }}>INTERNAL</span>
                  <div style={{ flex: 1 }}/>
                  <button onClick={() => { setNotesBillId(null); setQuickNote('') }} style={{
                    padding: '5px 12px', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 6,
                    fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={saveQuickNote} disabled={savingQuickNote || !quickNote.trim()} style={{
                    padding: '5px 14px', background: 'var(--teal)', color: 'var(--bg)',
                    border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', opacity: (savingQuickNote || !quickNote.trim()) ? 0.5 : 1,
                    boxShadow: 'var(--teal-glow)',
                  }}>{savingQuickNote ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            )}
          </Link>
          </SwipeableRow>
        )})}

      </div>
      <Nav/>
    </div>
  )
}
