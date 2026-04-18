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
 * Brand voice: Shorepine Civic Tech. Terse, actionable, no jargon.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import { useSession } from '../../lib/useSession'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp. Ch.', 'Conf.', 'Gov.']

// ── helpers ──────────────────────────────────────────────────────────────────

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

  const [view, setView] = useState('calendar') // 'calendar' | 'by-committee'
  const [chamberFilter, setChamberFilter] = useState('All')

  // Calendar state
  const [meetings, setMeetings] = useState([])
  const [meetingLoading, setMeetingLoading] = useState(true)
  const [committeeSlugs, setCommitteeSlugs] = useState({}) // {name|chamber: slug}

  // By-committee (legacy) state
  const [committees, setCommittees] = useState([])
  const [rulesQueue, setRulesQueue] = useState([])
  const [sortBy, setSortBy] = useState('bills')
  const [expanded, setExpanded] = useState(null)
  const [expandedBills, setExpandedBills] = useState([])
  const [committeeLoading, setCommitteeLoading] = useState(true)

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
    async function load() {
      const { data } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, category, committee_name, committee_passed, has_public_hearing, stalled, prime_sponsor, prime_party, bipartisan')
        .eq('session', SESSION)
        .not('committee_name', 'is', null)
        .not('committee_name', 'eq', '')
        .order('final_score', { ascending: false })
        .range(0, 2999)

      if (!data) { setCommitteeLoading(false); return }

      const RULES_NAMES = ['Rules 2 Review', 'Rules Committee for second reading', 'Rules']
      const isRules = n => RULES_NAMES.some(r => (n || '').toLowerCase().includes(r.toLowerCase()))

      const map = {}, rulesMap = {}
      data.forEach(b => {
        const target = isRules(b.committee_name) ? rulesMap : map
        const key = b.committee_name + '|' + b.chamber
        if (!target[key]) {
          target[key] = {
            key, name: b.committee_name, chamber: b.chamber,
            bills: [], totalScore: 0, passed: 0, hearings: 0, highScore: 0, stalled: 0,
            isRulesQueue: isRules(b.committee_name),
          }
        }
        target[key].bills.push(b)
        target[key].totalScore += (b.final_score || 0)
        if (b.committee_passed) target[key].passed++
        if (b.has_public_hearing) target[key].hearings++
        if ((b.final_score || 0) >= 50) target[key].highScore++
        if (b.stalled) target[key].stalled++
      })

      const toList = m => Object.values(m).map(c => ({
        ...c,
        billCount: c.bills.length,
        avgScore: Math.round(c.totalScore / c.bills.length),
        passRate: Math.round((c.passed / c.bills.length) * 100),
      }))

      setCommittees(toList(map))
      setRulesQueue(toList(rulesMap))
      setCommitteeLoading(false)
    }
    load()
  }, [view, SESSION])

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

      {/* HEADER */}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
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
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[['calendar', 'Calendar'], ['by-committee', 'By Committee']].map(([val, label]) => (
            <button key={val} onClick={() => setView(val)} style={{
              padding: '5px 14px', borderRadius: 16, fontSize: 11, fontWeight: 600,
              background: view === val ? 'var(--teal)' : 'transparent',
              color: view === val ? 'var(--bg)' : 'var(--text-muted)',
              border: '1px solid ' + (view === val ? 'var(--teal)' : 'var(--border)'),
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: view === val ? 'var(--teal-glow)' : 'none',
            }}>{label}</button>
          ))}
        </div>

        {/* Chamber filter */}
        <div style={{ display: 'flex', gap: 6 }}>
          {['All', 'House', 'Senate', 'Joint'].map(c => (
            <button key={c} onClick={() => setChamberFilter(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
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
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              Loading meetings…
            </div>
          ) : filteredMeetings.length === 0 ? (
            <div style={{
              padding: '40px 20px', textAlign: 'center',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            }}>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 6 }}>
                No scheduled meetings in the next two weeks.
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                During deep interim this is normal. Meetings populate as committees post agendas.
              </div>
            </div>
          ) : (
            ['Today', 'This Week', 'Next 2 Weeks', 'Later'].map(bucket => {
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
                    {items.map(m => (
                      <MeetingCard key={m.id} m={m}
                        highlight={interimMode && bucket === 'Today'}
                        onClick={() => goToCommittee(m.committee_name, m.chamber)} />
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* BY COMMITTEE VIEW (legacy aggregation, preserved) */}
      {view === 'by-committee' && (
        <ByCommitteeView
          committees={committees}
          rulesQueue={rulesQueue}
          loading={committeeLoading}
          chamberFilter={chamberFilter}
          sortBy={sortBy} setSortBy={setSortBy}
          expanded={expanded} setExpanded={setExpanded}
          expandedBills={expandedBills} setExpandedBills={setExpandedBills}
          slugs={committeeSlugs}
          router={router}
        />
      )}

      <Nav />
    </div>
  )
}

// ── Meeting card ─────────────────────────────────────────────────────────────

function MeetingCard({ m, highlight, onClick }) {
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

function ByCommitteeView({ committees, rulesQueue, loading, chamberFilter, sortBy, setSortBy, expanded, setExpanded, expandedBills, setExpandedBills, slugs, router }) {
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

  const allCommittees = [...committees, ...rulesQueue]
  const filteredRules = chamberFilter === 'All' || chamberFilter === 'Joint'
    ? rulesQueue
    : rulesQueue.filter(c => c.chamber === chamberFilter)

  function handleExpand(key) {
    if (expanded === key) {
      setExpanded(null); setExpandedBills([])
    } else {
      setExpanded(key)
      const c = allCommittees.find(x => x.key === key)
      setExpandedBills(c ? c.bills.slice(0, 20) : [])
    }
  }

  function openDetail(e, cmte) {
    e.stopPropagation()
    const slug = slugs[`${cmte.name}|${cmte.chamber}`]
    if (slug) router.push(`/committees/${slug}`)
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <>
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
              <div onClick={() => handleExpand(cmte.key)} style={{
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
                  {expandedBills.map(bill => (
                    <div key={bill.bill_id} onClick={() => router.push('/bill/' + bill.bill_id)} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderRadius: 6, cursor: 'pointer', transition: 'background 0.15s',
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* RULES / FLOOR QUEUE */}
      {filteredRules.length > 0 && (
        <div style={{ padding: '4px 16px 12px' }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8,
            padding: '10px 0', borderTop: '1px solid var(--border)',
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--gold)' }}>
              Floor Queue
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {filteredRules.reduce((s, c) => s + c.billCount, 0)} bills awaiting floor vote
            </span>
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10,
            padding: '8px 12px', background: 'rgba(184,151,90,0.04)', borderRadius: 8,
            border: '1px solid rgba(184,151,90,0.12)',
          }}>
            Passed their policy committee, queued in Rules for a floor vote. Being in the queue doesn't guarantee one — many die here when the session clock runs out.
          </div>
          {filteredRules.map(cmte => (
            <div key={cmte.key} onClick={() => handleExpand(cmte.key)} style={{
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
