'use client'
/**
 * Vector | WA — /committees (Phase 11.1 rebuild)
 *
 * Default view: meeting calendar (Today / This Week / Next 2 Weeks / Later).
 * Toggle to "By Committee" preserves the prior aggregation/expand view so
 * we don't lose the Rules Floor Queue surfacing.
 *
 * Data sources:
 *   - committee_meetings (Phase 11.1 new)
 *   - meeting_agenda_items (Phase 11.1 new)
 *   - bills (for the By Committee roll-up + Rules queue)
 *   - committees (Phase 11.1 new, used for slug-based links)
 *
 * Brand guide: Vector | WA Brand Guide v1.2.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { watchlistStore } from '../../lib/watchlist-store'
import { useSession } from '../../lib/useSession'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import ScoreBadge from '../components/ScoreBadge'
import VectorLoader from '../components/VectorLoader'

import { STAGE_SHORT } from '../../lib/stages'
import {
  isInterimPeriod, getCurrentBiennium, getNextBiennium, formatSessionDate, daysUntil,
  bienniumShortLabel, dayOfSessionOrNull,
} from '../../lib/session-config'
// ── helpers ──────────────────────────────────────────────────────────────────
// dayOfSessionOrNull + bienniumShortLabel were lifted to session-config.js
// in Thread 11 (per Universal Guardrail G1) so bill detail / member detail
// can import them without copy-paste. Local helpers kept below for layout.

function fmtTime(timeStr) {
  if (!timeStr) return ''
  // timeStr format "HH:MM:SS"
  const [h, m] = timeStr.split(':').map(Number)
  const hr12 = h % 12 || 12
  const ampm = h >= 12 ? 'pm' : 'am'
  return `${hr12}${m ? ':' + String(m).padStart(2, '0') : ''}${ampm}`
}

function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function bucketize(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.floor((d - today) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Today'
  // "This Week" = today → end of current week (Sunday)
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()))
  if (d <= endOfWeek) return 'This Week'
  const twoWeeksOut = new Date(today)
  twoWeeksOut.setDate(today.getDate() + 14)
  if (d <= twoWeeksOut) return 'Next 2 Weeks'
  return 'Later'
}

// ── component ────────────────────────────────────────────────────────────────

export default function CommitteesPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [SESSION] = useSession()
  // Phase 12 Batch 6 — capability-aware nav swap for anon visitors.
  // Thread 15.2: viewerLoading destructured + isAnonPublic gated on !viewerLoading
  // so authed users no longer flash PublicNav during the auth-resolve window.
  const { user, capabilities, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  const [view, setView] = useState('calendar') // 'calendar' | 'by-committee'
  const [chamberFilter, setChamberFilter] = useState('All')

  // Calendar state
  const [meetings, setMeetings] = useState([])
  const [meetingLoading, setMeetingLoading] = useState(true)
  const [committeeSlugs, setCommitteeSlugs] = useState({}) // {name|chamber: slug}

  // Thread 103 — watched bills for "YOUR BILLS" section
  const [watchedBillIds, setWatchedBillIds] = useState(new Set())
  const [watchedBillDetails, setWatchedBillDetails] = useState({})

  // By-committee (legacy) state
  const [committees, setCommittees] = useState([])
  const [rulesQueue, setRulesQueue] = useState([])
  const [sortBy, setSortBy] = useState('bills')
  const [expanded, setExpanded] = useState(null)
  const [expandedBills, setExpandedBills] = useState([])
  // Thread 70 — expand-on-click bills are now lazy-fetched (one bounded
  // query per expansion, top 20 by score) instead of held in state from
  // the bulk load. expandedLoading drives the inline loader.
  const [expandedLoading, setExpandedLoading] = useState(false)
  const [committeeLoading, setCommitteeLoading] = useState(true)

  // Thread 103 — fetch watched bills when user is logged in.
  // PORTAL-2: anon viewers load the device-local list when the public
  // layer is on. Local rows can't join bills(...) (PORTAL_DEEP_DIVE.md
  // §2.3), so the anon path hydrates by ids: local ids() → one
  // bills .in() query — bills is anon-readable, and the 200-item local
  // cap stays far under the 1000-row PostgREST limit.
  useEffect(() => {
    if (viewerLoading) return
    if (!user && !capabilities.canSave) return
    async function loadWatched() {
      if (user) {
        const { data } = await watchlistStore(user).list({
          select: 'bill_id, bills(bill_id, bill_number, title, chamber, final_score)',
          ordered: false,
        })
        const ids = new Set((data || []).map(d => d.bill_id))
        setWatchedBillIds(ids)
        const byId = {}
        ;(data || []).forEach(d => { if (d.bills) byId[d.bill_id] = d.bills })
        setWatchedBillDetails(byId)
        return
      }
      const { data: idRows } = await watchlistStore(user).ids()
      const localIds = (idRows || []).map(d => d.bill_id)
      setWatchedBillIds(new Set(localIds))
      const byId = {}
      if (localIds.length > 0) {
        const { data: billRows } = await supabase
          .from('bills')
          .select('bill_id, bill_number, title, chamber, final_score')
          .in('bill_id', localIds)
        ;(billRows || []).forEach(b => { byId[b.bill_id] = b })
      }
      setWatchedBillDetails(byId)
    }
    loadWatched()
  }, [user?.id, viewerLoading])

  // Load committees (for slug lookups)
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('committees').select('name, chamber, slug')
      const map = {}
      ;(data || []).forEach(c => { map[`${c.name}|${c.chamber}`] = c.slug })
      setCommitteeSlugs(map)
    }
    load()
  }, [])

  // Load meetings
  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('committee_meetings')
        .select(`
          id, committee_id, committee_name, chamber, is_joint,
          meeting_date, meeting_time, location, meeting_type, agenda_url,
          meeting_agenda_items(id, bill_id)
        `)
        .gte('meeting_date', today)
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true })
        .limit(300)

      setMeetings(data || [])
      setMeetingLoading(false)
    }
    load()
  }, [])

  // Load by-committee aggregation (only when user flips view; re-runs on session change)
  useEffect(() => {
    if (view !== 'by-committee') return
    setCommitteeLoading(true)
    setCommittees([])
    setRulesQueue([])
    // Reset any stale expansion when the source data is about to refresh.
    setExpanded(null); setExpandedBills([]); setExpandedLoading(false)
    async function load() {
      // Thread 70 — server-side aggregation via v_committee_stats_by_session.
      // Replaces a client-side reduce loop over .range(0, 2999) bills that
      // was silently truncated by PostgREST's 1000-row cap (2025-2026:
      // 3,133 bills → 1,000 returned; ~68% loss). Compounded because the
      // ORDER BY final_score DESC made the surviving slice top-1000-scoring
      // bills, hiding low-score committees from the page entirely.
      // The view pre-aggregates per (session, name, chamber) and returns
      // ~65 rows; expand-on-click bills are lazy-fetched in handleExpand.
      const { data, error } = await supabase
        .from('v_committee_stats_by_session')
        .select('name, chamber, bill_count, committee_passes, hearing_count, high_score_count, stalled_count, avg_score, top_score, pass_rate, is_rules, slug')
        .eq('session', SESSION)

      if (error || !data) { setCommitteeLoading(false); return }

      // Thread 15.3 procedural-shelf override, preserved as defense-in-depth.
      // `Rules 2 Review` IS currently flagged is_rules=true in the committees
      // table (verified Thread 70), so the override is a no-op today — but
      // it ensures /committees stays correct if a future sync ever resets
      // the flag. Add new procedural shelves to this set as needed.
      const PROCEDURAL_SHELF_NAMES = new Set(['rules 2 review'])
      const isRulesRow = (row) =>
        row.is_rules || PROCEDURAL_SHELF_NAMES.has((row.name || '').toLowerCase())

      const policy = [], rules = []
      for (const row of data) {
        const item = {
          key: row.name + '|' + row.chamber,
          name: row.name,
          chamber: row.chamber,
          billCount: row.bill_count,
          avgScore: row.avg_score,
          passRate: row.pass_rate,
          passed: row.committee_passes,
          hearings: row.hearing_count,
          highScore: row.high_score_count,
          stalled: row.stalled_count,
          isRulesQueue: isRulesRow(row),
        }
        if (item.isRulesQueue) rules.push(item)
        else policy.push(item)
      }

      setCommittees(policy)
      setRulesQueue(rules)
      setCommitteeLoading(false)
    }
    load()
  }, [view, SESSION])

  // Thread 70 — lazy-fetch the top 20 bills for the expanded committee.
  // Lifted out of ByCommitteeView so it can use supabase + SESSION from the
  // parent scope. Toggling off (clicking the open committee again) clears
  // state without a network call. Toggling between committees fires one
  // bounded query (~20 rows) per expansion.
  async function handleExpand(name, chamber) {
    const key = name + '|' + chamber
    if (expanded === key) {
      setExpanded(null); setExpandedBills([]); setExpandedLoading(false)
      return
    }
    setExpanded(key)
    setExpandedBills([])
    setExpandedLoading(true)
    const { data } = await supabase
      .from('bills')
      .select('bill_id, bill_number, title, final_score, stage, chamber')
      .eq('session', SESSION)
      .eq('committee_name', name)
      .eq('chamber', chamber)
      .order('final_score', { ascending: false })
      .limit(20)
    setExpandedBills(data || [])
    setExpandedLoading(false)
  }

  // Thread 103 — cross-reference meetings against watchlist (client-side, no extra query)
  const myMeetings = useMemo(() => {
    if (!watchedBillIds.size || !meetings.length) return []
    return meetings
      .map(m => {
        const myBills = (m.meeting_agenda_items || [])
          .filter(a => watchedBillIds.has(a.bill_id))
          .map(a => a.bill_id)
        return myBills.length > 0 ? { ...m, myBills } : null
      })
      .filter(Boolean)
  }, [meetings, watchedBillIds])

  // Filter meetings by chamber
  const filteredMeetings = useMemo(() => {
    if (chamberFilter === 'All') return meetings
    if (chamberFilter === 'Joint') return meetings.filter(m => m.is_joint)
    return meetings.filter(m => m.chamber === chamberFilter && !m.is_joint)
  }, [meetings, chamberFilter])

  // Group meetings by time bucket
  const buckets = useMemo(() => {
    const groups = { 'Today': [], 'This Week': [], 'Next 2 Weeks': [], 'Later': [] }
    filteredMeetings.forEach(m => {
      const b = bucketize(m.meeting_date)
      if (groups[b]) groups[b].push(m)
    })
    return groups
  }, [filteredMeetings])

  // Interim awareness — highlight first meeting when total volume is low
  const interimMode = filteredMeetings.length > 0 && filteredMeetings.length <= 10

  function goToCommittee(name, chamber) {
    const slug = committeeSlugs[`${name}|${chamber}`]
    if (slug) router.push(`/committees/${slug}`)
  }

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
      {/* Phase 12 Batch 6 — anon visitors get PublicNav at top + no owner Nav below. */}
      {isAnonPublic && <PublicNav />}

      {/* HEADER */}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 16px 14px' : '52px 16px 14px',
        position: 'sticky', top: isAnonPublic ? 60 : 0, zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
            color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)',
          }}>
            Committees
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {view === 'calendar' ? `${filteredMeetings.length} meetings` : `${committees.length} committees`}
          </div>
        </div>

        {/* View toggle: Calendar / By Committee */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {[['calendar', 'Calendar'], ['by-committee', 'By Committee']].map(([val, label]) => (
            <button key={val} onClick={() => setView(val)} style={{
              padding: '5px 14px', borderRadius: 16, fontSize: 11, fontWeight: 600,
              minHeight: 28, display: 'inline-flex', alignItems: 'center',
              background: view === val ? 'var(--teal)' : 'transparent',
              color: view === val ? 'var(--bg)' : 'var(--text-muted)',
              border: '1px solid ' + (view === val ? 'var(--teal)' : 'var(--border)'),
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: view === val ? 'var(--teal-glow)' : 'none',
            }}>{label}</button>
          ))}
        </div>

        {/* Chamber filter */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['All', 'House', 'Senate', 'Joint'].map(c => (
            <button key={c} onClick={() => setChamberFilter(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
              minHeight: 28, display: 'inline-flex', alignItems: 'center',
              background: chamberFilter === c ? 'var(--bg-surface)' : 'transparent',
              color: chamberFilter === c ? 'var(--text-primary)' : 'var(--text-faint)',
              border: '1px solid ' + (chamberFilter === c ? 'var(--border)' : 'transparent'),
              cursor: 'pointer',
            }}>{c}</button>
          ))}
        </div>
      </div>

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div style={{ padding: '12px 16px' }}>
          {meetingLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <VectorLoader label="Loading meetings" />
            </div>
          ) : filteredMeetings.length === 0 ? (
            isInterimPeriod() ? (
              (() => {
                const current = getCurrentBiennium()
                const next = getNextBiennium()
                // getNextBiennium falls back to current when BIENNIUMS hasn't been
                // extended. Detect and fall back to generic copy so we never say
                // "dark until <current's start>" (which would be in the past).
                const hasRealNext = next && current && next.session !== current.session
                const daysAway = hasRealNext ? daysUntil(next.start) : null
                const pastLabel = bienniumShortLabel(current?.session)
                const nextShort = hasRealNext ? bienniumShortLabel(next.session) : ''
                return (
                  <div style={{
                    padding: '40px 20px', textAlign: 'center',
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  }}>
                    <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {hasRealNext
                        ? `The legislative calendar is dark until ${formatSessionDate(next.start)}.`
                        : 'The legislative calendar is dark until the next session convenes.'}
                    </div>
                    {hasRealNext && daysAway !== null && (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 14 }}>
                        {daysAway} days until the {nextShort} session convenes.
                      </div>
                    )}
                    <button onClick={() => setView('by-committee')} style={{
                      padding: '7px 14px', fontSize: 11, fontWeight: 600,
                      background: 'transparent', color: 'var(--teal)',
                      border: '1px solid var(--teal)', borderRadius: 6,
                      cursor: 'pointer', fontFamily: 'var(--font-mono)',
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                    }}>
                      Browse {pastLabel || current?.session} committee activity →
                    </button>
                  </div>
                )
              })()
            ) : (
              <div style={{
                padding: '40px 20px', textAlign: 'center',
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              }}>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 6 }}>
                  No scheduled meetings in the next two weeks.
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  Meetings populate as committees post agendas.
                </div>
              </div>
            )
          ) : (
            <>
            {/* ER-B4 (A8) — interim context banner. During the interim the WA
                Legislature holds committee work sessions that carry no bills, so
                every meeting card reads "0 bills" — a ghost-town effect that looks
                like a broken scraper. This strip gives the run of zero-agenda cards
                context, matching the home BillsMovingWidget interim posture. */}
            {isInterimPeriod() && (() => {
              const _next = getNextBiennium()
              const _cur = getCurrentBiennium()
              const _hasNext = _next && _cur && _next.session !== _cur.session
              return (
                <div style={{
                  marginBottom: 16, padding: '11px 14px',
                  background: 'rgba(184,151,90,0.06)',
                  border: '1px solid rgba(184,151,90,0.22)',
                  borderRadius: 'var(--radius)',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                    color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase',
                    marginBottom: 4,
                  }}>Interim — no active agenda</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    The Legislature is between sessions. Any meetings below are committee work
                    sessions and hearings with no bills on the agenda — bill referrals resume
                    {_hasNext ? ` when the ${bienniumShortLabel(_next.session)} session convenes ${formatSessionDate(_next.start)}` : ' when the next session convenes'}.
                  </div>
                </div>
              )
            })()}

            {/* Thread 103 — YOUR BILLS pinned section */}
            {user && myMeetings.length > 0 && !meetingLoading && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                  color: 'var(--teal)', letterSpacing: '0.08em', textTransform: 'uppercase',
                  marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(184,151,90,0.3)',
                  display: 'flex', alignItems: 'baseline', gap: 8,
                }}>
                  Your Bills
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>
                    {myMeetings.length} {myMeetings.length === 1 ? 'meeting' : 'meetings'} with your tracked bills
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {myMeetings.map(m => {
                    const slug = committeeSlugs[`${m.committee_name}|${m.chamber}`]
                    return (
                      <div key={'my-' + m.id}>
                        <MeetingCard
                          m={m}
                          highlight={false}
                          myBillCount={m.myBills.length}
                          onClick={() => { if (slug) router.push('/committees/' + slug) }}
                        />
                        {/* Bill chips */}
                        {m.myBills.length > 0 && (
                          <div style={{
                            display: 'flex', flexWrap: 'wrap', gap: 5,
                            padding: '6px 14px 8px',
                            background: 'rgba(184,151,90,0.04)',
                            border: '1px solid rgba(184,151,90,0.2)',
                            borderTop: 'none',
                            borderRadius: '0 0 var(--radius) var(--radius)',
                            marginTop: -6,
                          }}>
                            {m.myBills.map(billId => {
                              const bill = watchedBillDetails[billId]
                              if (!bill) return null
                              const prefix = bill.chamber === 'House' ? 'HB' : 'SB'
                              return (
                                <Link
                                  key={billId}
                                  href={`/bill/${billId}`}
                                  onClick={e => e.stopPropagation()}
                                  style={{
                                    fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
                                    color: 'var(--teal)', padding: '2px 7px', borderRadius: 10,
                                    border: '1px solid rgba(184,151,90,0.35)',
                                    background: 'rgba(184,151,90,0.08)',
                                    letterSpacing: '0.04em',
                                    textDecoration: 'none', cursor: 'pointer',
                                  }}
                                >
                                  {prefix} {bill.bill_number}{bill.final_score != null ? ` · ${bill.final_score}` : ''}
                                </Link>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {['Today', 'This Week', 'Next 2 Weeks', 'Later'].map(bucket => {
              const items = buckets[bucket]
              if (!items || items.length === 0) return null
              return (
                <div key={bucket} style={{ marginBottom: 20 }}>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
                    color: 'var(--gold)', letterSpacing: '0.04em', textTransform: 'uppercase',
                    marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)',
                  }}>
                    {bucket}
                    <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-faint)', fontWeight: 400, letterSpacing: 0 }}>
                      {items.length} {items.length === 1 ? 'meeting' : 'meetings'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {items.map(m => {
                        const myBillCount = myMeetings.find(mm => mm.id === m.id)?.myBills?.length || 0
                        return (
                          <MeetingCard key={m.id} m={m}
                            highlight={interimMode && bucket === 'Today'}
                            myBillCount={myBillCount}
                            onClick={() => goToCommittee(m.committee_name, m.chamber)} />
                        )
                      })}
                  </div>
                </div>
              )
            })}
            </>
          )}
        </div>
      )}

      {/* BY COMMITTEE VIEW — Thread 70 rewrites this to consume the
          v_committee_stats_by_session view. handleExpand is a parent-scope
          callback so it can hit supabase + SESSION for the lazy bill fetch. */}
      {view === 'by-committee' && (
        <ByCommitteeView
          committees={committees}
          rulesQueue={rulesQueue}
          loading={committeeLoading}
          chamberFilter={chamberFilter}
          sortBy={sortBy} setSortBy={setSortBy}
          expanded={expanded}
          expandedBills={expandedBills}
          expandedLoading={expandedLoading}
          handleExpand={handleExpand}
          slugs={committeeSlugs}
          router={router}
        />
      )}

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}

// ── Meeting card ─────────────────────────────────────────────────────────────

function MeetingCard({ m, highlight, onClick, myBillCount }) {
  const billCount = (m.meeting_agenda_items || []).filter(a => a.bill_id).length
  const chamberColor = m.is_joint ? 'var(--gold)' : m.chamber === 'Senate' ? 'var(--teal)' : 'var(--gold)'

  return (
    <div onClick={onClick} style={{
      background: 'var(--bg-card)',
      border: '1px solid ' + (highlight ? 'rgba(184,151,90,0.4)' : 'var(--border)'),
      borderRadius: 'var(--radius)',
      padding: '12px 14px',
      cursor: 'pointer',
      transition: 'border-color 0.2s, background 0.15s',
      boxShadow: highlight ? 'var(--teal-glow)' : 'none',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(184,151,90,0.03)'}
    onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>

        {/* Date/time block */}
        <div style={{
          minWidth: 64, textAlign: 'center',
          padding: '6px 8px', borderRight: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {fmtDayLabel(m.meeting_date).split(' ')[0]}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>
            {fmtDayLabel(m.meeting_date).split(' ').slice(1).join(' ')}
          </div>
          {m.meeting_time && (
            <div style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              {fmtTime(m.meeting_time)}
            </div>
          )}
        </div>

        {/* Committee info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {m.committee_name || 'Committee'}
            </span>
            {m.is_joint && (
              <span style={{
                fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                background: 'rgba(184,151,90,0.12)', color: 'var(--gold)',
                border: '1px solid rgba(184,151,90,0.3)',
              }}>JOINT</span>
            )}
            {!m.is_joint && (
              <span style={{
                fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 500,
                background: 'rgba(184,151,90,0.08)', color: chamberColor,
                border: '1px solid rgba(184,151,90,0.2)',
              }}>{m.chamber}</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
            {m.meeting_type && (
              <span style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 8,
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', fontFamily: 'var(--font-mono)',
              }}>{m.meeting_type}</span>
            )}
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {billCount} {billCount === 1 ? 'bill' : 'bills'}
            </span>
            {myBillCount > 0 && (
              <span style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: 'var(--teal)', padding: '1px 6px', borderRadius: 10,
                border: '1px solid rgba(184,151,90,0.4)',
                background: 'rgba(184,151,90,0.1)',
                letterSpacing: '0.04em',
              }}>
                {myBillCount} tracked
              </span>
            )}
            {m.location && (
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                {m.location}
              </span>
            )}
          </div>
        </div>

        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, marginTop: 4 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  )
}

// ── By-Committee legacy view (extracted into a subcomponent) ─────────────────

function ByCommitteeView({ committees, rulesQueue, loading, chamberFilter, sortBy, setSortBy, expanded, expandedBills, expandedLoading, handleExpand, slugs, router }) {
  const filtered = chamberFilter === 'All' || chamberFilter === 'Joint'
    ? committees
    : committees.filter(c => c.chamber === chamberFilter)

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === 'bills') return b.billCount - a.billCount
      if (sortBy === 'score') return b.avgScore - a.avgScore
      if (sortBy === 'passed') return b.passRate - a.passRate
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      return 0
    })
  }, [filtered, sortBy])

  const filteredRules = chamberFilter === 'All' || chamberFilter === 'Joint'
    ? rulesQueue
    : rulesQueue.filter(c => c.chamber === chamberFilter)

  // Thread 70 — handleExpand is now a parent-scope callback (see CommitteesPage)
  // so it can lazy-fetch the top 20 bills via supabase + SESSION. Local
  // allCommittees lookup is no longer needed (the parent uses name + chamber).

  function openDetail(e, cmte) {
    e.stopPropagation()
    const slug = slugs[`${cmte.name}|${cmte.chamber}`]
    if (slug) router.push(`/committees/${slug}`)
  }

  if (loading) {
    return <VectorLoader label="Loading committees" />
  }

  // Sub-task 3 — date anchor above the sort row so By-Committee never looks
  // rootless. During interim we remind the viewer they're reading last-session
  // data; during active session we surface the day count (and during the
  // pre-filing window we show a countdown to gavel-in). All labels derive from
  // getCurrentBiennium() / getNextBiennium() so they auto-roll each cycle.
  const _interim = isInterimPeriod()
  const _biennium = getCurrentBiennium()
  const _nextBiennium = getNextBiennium()
  // Guard against getNextBiennium() falling back to current when BIENNIUMS
  // hasn't been extended (e.g., post-2028 sine die before the 2029-30 entry
  // is filed). Without this, forward-looking copy loops back to the current
  // biennium's label and reads as nonsense.
  const _hasRealNext = _nextBiennium && _biennium && _nextBiennium.session !== _biennium.session
  const _dayOfSession = dayOfSessionOrNull()
  const _currentLabel = bienniumShortLabel(_biennium?.session)
  const _nextLabel = _hasRealNext ? bienniumShortLabel(_nextBiennium.session) : ''

  return (
    <>
      {/* Session date anchor */}
      <div style={{
        padding: '10px 16px 4px', fontSize: 11, color: 'var(--text-faint)',
        fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
      }}>
        {_interim ? (
          <>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{_currentLabel} committee activity</span>
            {' · session ended '}{formatSessionDate(_biennium.end)}
          </>
        ) : _dayOfSession ? (
          <>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Live committee assignments</span>
            {' · Day '}{_dayOfSession}{' of '}{_biennium.session}{' session'}
          </>
        ) : (
          <>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{_biennium.session} committee assignments</span>
            {' · session convenes '}{formatSessionDate(_biennium.start)}
          </>
        )}
      </div>

      {/* Sort buttons */}
      <div style={{ padding: '8px 16px 4px', display: 'flex', gap: 6 }}>
        {[['bills', 'By Size'], ['score', 'By Score'], ['passed', 'Pass Rate'], ['name', 'A-Z']].map(([val, label]) => (
          <button key={val} onClick={() => setSortBy(val)} style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 10,
            background: sortBy === val ? 'var(--bg-surface)' : 'transparent',
            color: sortBy === val ? 'var(--text-primary)' : 'var(--text-faint)',
            border: '1px solid ' + (sortBy === val ? 'var(--border)' : 'transparent'),
            cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {sorted.map((cmte, idx) => {
          const isExpanded = expanded === cmte.key
          const scoreColor = cmte.avgScore >= 50 ? 'var(--teal)' : cmte.avgScore >= 35 ? 'var(--gold)' : 'var(--text-muted)'
          const barWidth = Math.min(cmte.passRate, 100)
          return (
            <div key={cmte.key}>
              <div onClick={() => handleExpand(cmte.name, cmte.chamber)} style={{
                background: 'var(--bg-card)',
                border: '1px solid ' + (isExpanded ? 'rgba(184,151,90,0.3)' : 'var(--border)'),
                borderRadius: isExpanded ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                padding: '14px', cursor: 'pointer', transition: 'border-color 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <ScoreBadge score={cmte.avgScore} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span onClick={(e) => openDetail(e, cmte)} style={{
                        fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
                        textDecoration: 'underline', textDecorationColor: 'rgba(184,151,90,0.2)', textUnderlineOffset: 3,
                      }}>{cmte.name}</span>
                      <span style={{
                        fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 500,
                        background: 'rgba(184,151,90,0.08)', color: cmte.chamber === 'Senate' ? 'var(--teal)' : 'var(--gold)',
                        border: '1px solid rgba(184,151,90,0.25)',
                      }}>{cmte.chamber}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{cmte.billCount} bills</span>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: scoreColor }}>avg {cmte.avgScore}</span>
                      {cmte.passed > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--teal-mid)' }}>{cmte.passed} passed ({cmte.passRate}%)</span>}
                      {cmte.highScore > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>{cmte.highScore} high</span>}
                    </div>
                    <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: barWidth + '%', background: cmte.passRate >= 50 ? 'var(--teal)' : cmte.passRate >= 25 ? 'var(--gold)' : 'var(--text-muted)', borderRadius: 2 }} />
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>

              {isExpanded && (
                <div style={{
                  background: 'rgba(14,16,20,0.6)', border: '1px solid rgba(184,151,90,0.3)', borderTop: 'none',
                  borderRadius: '0 0 var(--radius) var(--radius)', padding: '8px 10px',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  {/* Thread 70 — bills are lazy-fetched on expand (top 20 by score). */}
                  {expandedLoading && (
                    <div style={{
                      padding: '12px 10px', fontSize: 11, color: 'var(--text-faint)',
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                    }}>
                      Loading bills…
                    </div>
                  )}
                  {!expandedLoading && expandedBills.length === 0 && (
                    <div style={{
                      padding: '12px 10px', fontSize: 11, color: 'var(--text-faint)',
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                    }}>
                      No bills returned for this committee.
                    </div>
                  )}
                  {!expandedLoading && expandedBills.map(bill => (
                    <Link key={bill.bill_id} href={'/bill/' + bill.bill_id} prefetch={false} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderRadius: 6, cursor: 'pointer', transition: 'background 0.15s',
                      textDecoration: 'none', color: 'inherit',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(184,151,90,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <ScoreBadge score={bill.final_score} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500 }}>
                            {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                          </span>
                          <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                            {STAGE_SHORT[bill.stage] || 'Intro'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {bill.title || 'Bill ' + bill.bill_number}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* RULES / FLOOR QUEUE — re-labeled during interim since there's no live
          floor activity; these are 2025-26 bills that got stuck in Rules at
          sine die. Active-session copy is preserved unchanged. */}
      {filteredRules.length > 0 && (
        <div style={{ padding: '4px 16px 12px' }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8,
            padding: '10px 0', borderTop: '1px solid var(--border)',
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--gold)' }}>
              {_interim ? `Died in Rules (${_currentLabel})` : 'Floor Queue'}
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {_interim
                ? `${filteredRules.reduce((s, c) => s + c.billCount, 0)} bills cleared policy committee but didn't get a floor vote`
                : `${filteredRules.reduce((s, c) => s + c.billCount, 0)} bills awaiting floor vote`}
            </span>
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10,
            padding: '8px 12px', background: 'rgba(184,151,90,0.04)', borderRadius: 8,
            border: '1px solid rgba(184,151,90,0.12)',
          }}>
            {_interim
              ? `These bills passed their policy committee during the ${_currentLabel} biennium but didn't get a floor vote before sine die on ${formatSessionDate(_biennium.end)}. They do not carry over — a reintroduction would start from scratch in the ${_nextLabel || 'next'} session.`
              : `Passed their policy committee, queued in Rules for a floor vote. Being in the queue doesn't guarantee one — many die here when the session clock runs out.`}
          </div>
          {filteredRules.map(cmte => (
            <div key={cmte.key} onClick={() => handleExpand(cmte.name, cmte.chamber)} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '14px', cursor: 'pointer', marginBottom: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ScoreBadge score={cmte.avgScore} size="sm" />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{cmte.name}</span>
                    <span style={{
                      fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 500,
                      background: 'rgba(184,151,90,0.08)', color: cmte.chamber === 'Senate' ? 'var(--teal)' : 'var(--gold)',
                      border: '1px solid rgba(184,151,90,0.25)',
                    }}>{cmte.chamber}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{cmte.billCount} bills</span>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>{cmte.highScore} high</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
