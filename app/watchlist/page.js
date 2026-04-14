'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp.Ch.', 'Conf.', 'Signed']

export default function WatchlistPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [watched, setWatched]               = useState([])
  const [clients, setClients]               = useState([])
  const [activeClient, setActiveClient]     = useState('All')
  const [sortBy, setSortBy]                 = useState('score')
  const [atRiskOnly, setAtRiskOnly]         = useState(false)
  const [scoreDeltas, setScoreDeltas]       = useState({})
  const [changes, setChanges]               = useState({})
  const [changesDismissed, setChangesDismissed] = useState(false)
  const [loading, setLoading]               = useState(true)
  const [exporting, setExporting]           = useState(false)
  // Phase 7S: quick-note state
  const [notesBillId, setNotesBillId]       = useState(null)
  const [quickNote, setQuickNote]           = useState('')
  const [savingQuickNote, setSavingQuickNote] = useState(false)
  const [billNoteMeta, setBillNoteMeta]     = useState({})  // { bill_id: { count, lastUpdated } }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      /* ── 1. Fetch tracked bills (now includes last_viewed_at) ── */
      const { data } = await supabase
        .from('tracked_bills')
        .select(`
          bill_id, client_tag, notes, added_at, last_viewed_at,
          bills (
            bill_id, bill_number, title, final_score,
            stage, chamber, category, committee_name,
            has_public_hearing, committee_passed,
            hearing_date, days_to_cutoff, status, stalled,
            prime_sponsor, prime_party, bipartisan,
            session, companion_bill, confidence_label, pass_probability
          )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

      const items = (data || []).filter(d => d.bills)
      setWatched(items)

      const allClients = [...new Set(items.map(d => d.client_tag).filter(Boolean))]
      setClients(allClients)

      /* ── 2. Find earliest last_viewed_at (they should all match) ── */
      const lastViewed = items.reduce((earliest, d) => {
        if (!d.last_viewed_at) return earliest
        if (!earliest) return d.last_viewed_at
        return d.last_viewed_at < earliest ? d.last_viewed_at : earliest
      }, null)

      /* ── 3. Fetch snapshots for deltas + change detection ── */
      const billIds = items.map(d => d.bill_id)
      if (billIds.length > 0) {
        const { data: snaps } = await supabase
          .from('trajectory_snapshots')
          .select('bill_id, score, stage, snapshot_date')
          .in('bill_id', billIds)
          .order('snapshot_date', { ascending: false })

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
              // Find the snapshot that was current when user last visited
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
      }

      /* ── 4. Phase 7S: fetch note counts per bill ── */
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

      /* ── 5. Update last_viewed_at to NOW ── */
      await supabase
        .from('tracked_bills')
        .update({ last_viewed_at: new Date().toISOString() })
        .eq('user_id', user.id)

      setLoading(false)
    }
    load()
  }, [])

  /* ── Filtering & sorting ── */
  const clientFiltered = activeClient === 'All'
    ? watched
    : watched.filter(d => d.client_tag === activeClient)
  const filtered = atRiskOnly
    ? clientFiltered.filter(d => (d.bills?.final_score || 0) < 25 || d.bills?.stalled)
    : clientFiltered

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

  /* ── PDF Export handler ── */
  const handleExport = async () => {
    setExporting(true)
    try {
      const { generateClientPDF } = await import('../../lib/generate-pdf')
      const clientName = activeClient !== 'All' ? activeClient : null
      const billsToExport = sorted // uses current filter
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

      // Phase 7S: fetch client-visible analyst notes for all tracked bills
      const { data: { user } } = await supabase.auth.getUser()
      let billNotes = []
      if (user) {
        const billIds = billsToExport.map(d => d.bill_id)
        if (billIds.length > 0) {
          const { data: notesData } = await supabase
            .from('bill_notes')
            .select('*')
            .eq('user_id', user.id)
            .eq('visibility', 'client')
            .in('bill_id', billIds)
            .order('created_at', { ascending: false })
          billNotes = notesData || []
        }
      }

      // Phase 10.5: fetch amendments and fiscal note history for activity line
      const billIds2 = billsToExport.map(d => d.bill_id)
      let amendmentsData = []
      let fiscalData = []
      if (billIds2.length > 0) {
        const { data: aData } = await supabase
          .from('amendments')
          .select('bill_id, amendment_number, adopted, floor_action_date')
          .in('bill_id', billIds2)
        amendmentsData = aData || []
        const { data: fData } = await supabase
          .from('fiscal_note_history')
          .select('bill_id, detected_date, new_size, note')
          .in('bill_id', billIds2)
        fiscalData = fData || []
      }

      await generateClientPDF({
        clientName,
        date: today,
        bills: billsToExport,
        scoreDeltas,
        changes,
        billNotes,
        amendments: amendmentsData,
        fiscalHistory: fiscalData,
      })
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('PDF export failed. Make sure jspdf is installed (npm install jspdf jspdf-autotable).')
    }
    setExporting(false)
  }

  /* ── Phase 7S: quick-note save handler ── */
  const saveQuickNote = async () => {
    if (!notesBillId || !quickNote.trim()) return
    setSavingQuickNote(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase
        .from('bill_notes')
        .insert({ bill_id: notesBillId, user_id: user.id, body: quickNote.trim(), visibility: 'internal' })
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
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
      {/* ━━━ HEADER ━━━ */}
      <div style={{
        background: 'rgba(8,12,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(0,229,204,0.2)' }}>
            Watchlist
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Export Report button */}
            {filtered.length > 0 && (
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{
                  padding: '4px 12px', borderRadius: 14, fontSize: 10, fontWeight: 600,
                  background: 'transparent',
                  color: 'var(--gold)',
                  border: '1px solid rgba(212,168,75,0.35)',
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
                {exporting ? 'Generating...' : 'Export PDF'}
              </button>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {filtered.length} bills
            </div>
          </div>
        </div>

        {filtered.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {[
              { label: 'Avg Score', value: avgScore, color: avgScore >= 45 ? 'var(--teal)' : avgScore >= 30 ? 'var(--gold)' : 'var(--text-muted)' },
              { label: 'High Score', value: highCount, color: highCount > 0 ? 'var(--teal)' : 'var(--text-muted)' },
              { label: 'Hearings', value: hearingCount, color: hearingCount > 0 ? 'var(--teal-mid)' : 'var(--text-muted)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color, textShadow: color === 'var(--teal)' ? '0 0 8px rgba(0,229,204,0.3)' : 'none' }}>{value}</span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {clients.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
            {['All', ...clients].map(c => (
              <button key={c} onClick={() => setActiveClient(c)} style={{
                padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
                background: activeClient === c ? 'var(--teal)' : 'transparent',
                color: activeClient === c ? 'var(--bg)' : 'var(--text-muted)',
                border: `1px solid ${activeClient === c ? 'var(--teal)' : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: activeClient === c ? 'var(--teal-glow)' : 'none',
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
              border: `1px solid ${atRiskOnly ? 'rgba(255,82,82,0.3)' : 'transparent'}`,
              cursor: 'pointer', fontWeight: atRiskOnly ? 600 : 400,
              boxShadow: atRiskOnly ? 'var(--danger-glow)' : 'none',
            }}>\u26a0 At Risk</button>
          </div>
        )}
      </div>

      {/* ━━━ CONTENT ━━━ */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>

        {/* ── WHAT'S CHANGED SECTION ── */}
        {!loading && showChanges && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(0,229,204,0.06), rgba(0,229,204,0.02))',
            border: '1px solid rgba(0,229,204,0.2)',
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
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', boxShadow: '0 0 6px rgba(0,229,204,0.5)', display: 'inline-block' }}/>
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
              >\u00d7</button>
            </div>

            {changedBills.map(({ bill_id, bills: bill }) => {
              const change = changes[bill_id]
              return (
                <div
                  key={bill_id}
                  onClick={() => router.push(`/bill/${bill.bill_id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                    borderTop: '1px solid rgba(0,229,204,0.08)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
                    minWidth: 56, fontWeight: 500,
                  }}>
                    {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                  </span>
                  <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {change.scoreDiff !== 0 && (
                      <span style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                        padding: '2px 8px', borderRadius: 10,
                        background: change.scoreDiff > 0 ? 'rgba(0,229,204,0.12)' : 'rgba(255,82,82,0.12)',
                        color: change.scoreDiff > 0 ? 'var(--teal)' : 'var(--danger)',
                        border: `1px solid ${change.scoreDiff > 0 ? 'rgba(0,229,204,0.25)' : 'rgba(255,82,82,0.25)'}`,
                      }}>
                        Score {change.oldScore} \u2192 {change.newScore} ({change.scoreDiff > 0 ? '+' : ''}{change.scoreDiff})
                      </span>
                    )}
                    {change.stageChanged && (
                      <span style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                        padding: '2px 8px', borderRadius: 10,
                        background: change.newStage > change.oldStage ? 'rgba(0,229,204,0.12)' : 'rgba(255,82,82,0.12)',
                        color: change.newStage > change.oldStage ? 'var(--teal)' : 'var(--danger)',
                        border: `1px solid ${change.newStage > change.oldStage ? 'rgba(0,229,204,0.25)' : 'rgba(255,82,82,0.25)'}`,
                      }}>
                        Stage {STAGE_SHORT[change.oldStage] || '?'} \u2192 {STAGE_SHORT[change.newStage] || '?'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── BILL CARDS ── */}
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16, filter: 'grayscale(0.5)' }}>📋</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--teal)', marginBottom: 8, fontWeight: 600 }}>
              No bills tracked yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Search bills and tap + Watch to add them here.
            </div>
            <button onClick={() => router.push('/search')} style={{
              padding: '10px 24px', background: 'var(--teal)', color: 'var(--bg)',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              boxShadow: 'var(--teal-glow)',
            }}>Browse Bills</button>
          </div>
        ) : sorted.map(({ bill_id, client_tag, notes, bills: bill }, idx) => {
          const delta = scoreDeltas[bill_id]
          const hasChange = changes[bill_id]
          return (
          <div
            key={bill_id}
            onClick={() => router.push(`/bill/${bill.bill_id}`)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px',
              cursor: 'pointer', transition: 'border-color 0.2s',
              borderLeft: bill.stalled ? '3px solid var(--danger)' : (bill.final_score >= 50 ? '3px solid var(--teal)' : '1px solid var(--border)'),
              animation: `fadeUp 0.3s ease ${idx * 0.03}s both`,
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <ScoreBadge score={bill.final_score} size="md" status={bill.confidence_label}/>
                {delta != null && delta !== 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -10,
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '1px 5px', borderRadius: 8,
                    background: delta > 0 ? 'rgba(0,229,204,0.15)' : 'rgba(255,82,82,0.15)',
                    color: delta > 0 ? 'var(--teal)' : 'var(--danger)',
                    border: `1px solid ${delta > 0 ? 'rgba(0,229,204,0.3)' : 'rgba(255,82,82,0.3)'}`,
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
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {STAGE_SHORT[bill.stage] || 'Intro'}
                  </span>
                  {client_tag && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(212,168,75,0.25)', borderRadius: 10, fontWeight: 500 }}>
                      {client_tag}
                    </span>
                  )}
                  {bill.stalled && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--danger-pale)', color: 'var(--danger)', border: '1px solid rgba(255,82,82,0.25)', borderRadius: 10 }}>
                      Stalled
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 6 }}>
                  {bill.title || bill.committee_name || 'Bill ' + bill.bill_number}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {bill.has_public_hearing && (
                    <span style={{ fontSize: 9, color: 'var(--teal-mid)', fontFamily: 'var(--font-mono)' }}>\u25cf HEARING</span>
                  )}
                  {bill.committee_passed && (
                    <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>\u2713 CMTE PASS</span>
                  )}
                  {!bill.bipartisan && (
                    <span style={{ fontSize: 9, color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>Minority Only</span>
                  )}
                </div>
                {notes && (
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
                    marginTop: 6, lineHeight: 1.4,
                    borderLeft: '2px solid var(--border)', paddingLeft: 8,
                  }}>{notes}</div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--gold)', filter: 'drop-shadow(0 0 4px rgba(212,168,75,0.3))' }}>🔖</div>
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
                {/* Note count badge */}
                {billNoteMeta[bill_id] && (
                  <span style={{
                    fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)',
                    textAlign: 'center', lineHeight: 1.2,
                  }}>
                    {billNoteMeta[bill_id].count} note{billNoteMeta[bill_id].count !== 1 ? 's' : ''}
                  </span>
                )}
                <a
                  href={`https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${(bill.session || '2025-2026').split('-')[0]}`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ color: 'var(--text-faint)', opacity: 0.5, transition: 'opacity 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                  title="View on leg.wa.gov"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
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
          </div>
        )})}

      </div>
      <Nav/>
    </div>
  )
}
