'use client'
/**
 * Vector | WA — /committees/[slug] (Phase 11.1 + roster)
 *
 * Committee detail page. Order of information (top → bottom):
 *   1. Upcoming meetings (PRIMARY)
 *   2. Tracked bills in this committee (SECONDARY)
 *   3. Roster — committee members with role badges
 */
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../../lib/supabase'
import { useSession } from '../../../lib/useSession'
import { useViewer } from '../../../lib/viewer-capabilities'
import { isInterimPeriod, getCurrentBiennium, getNextBiennium, formatSessionDate } from '../../../lib/session-config'
import Nav from '../../components/Nav'
import PublicNav from '../../components/PublicNav'
import ScoreBadge from '../../components/ScoreBadge'
import VectorLoader from '../../components/VectorLoader'
import { Check, Bell } from 'lucide-react'

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h >= 12 ? 'pm' : 'am'}`
}

function fmtDay(s) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function CommitteeDetail() {
  const router = useRouter()
  const params = useParams()
  const slug = params?.slug
  const supabase = createBrowserClient()
  const [SESSION] = useSession()
  const { user, capabilities, loading: viewerLoading, publicLayerEnabled } = useViewer()
  // Thread 15.2: gate isAnonPublic on !viewerLoading so authed users no longer
  // flash PublicNav (and lose the bottom Nav) during the auth resolve window.
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  const [committee, setCommittee] = useState(null)
  const [meetings, setMeetings] = useState([])
  const [bills, setBills] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Phase 11.2 — follow state
  const [follow, setFollow] = useState(null) // { alerts_enabled } or null
  const [followBusy, setFollowBusy] = useState(false)
  // Thread 105 — "YOUR TRACKED BILLS" float-to-top
  const [watchedIds, setWatchedIds] = useState(new Set())

  useEffect(() => {
    if (!slug) return
    if (viewerLoading) return
    async function load() {
      // 1. Committee
      const { data: cmte } = await supabase
        .from('committees')
        .select('id, name, chamber, slug, is_rules')
        .eq('slug', slug)
        .single()

      if (!cmte) { setNotFound(true); setLoading(false); return }
      setCommittee(cmte)

      // Phase 11.2 — load current follow state (user comes from useViewer hook)
      if (user) {
        const { data: fr } = await supabase
          .from('user_followed_committees')
          .select('alerts_enabled')
          .eq('user_id', user.id)
          .eq('committee_id', cmte.id)
          .maybeSingle()
        setFollow(fr || null)
      }

      const today = new Date().toISOString().split('T')[0]

      // 2. Meetings (upcoming first, limit 20)
      const { data: mtgs } = await supabase
        .from('committee_meetings')
        .select('id, meeting_date, meeting_time, location, meeting_type, is_joint, agenda_url, meeting_agenda_items(id, bill_id)')
        .eq('committee_id', cmte.id)
        .gte('meeting_date', today)
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true })
        .limit(20)
      setMeetings(mtgs || [])

      // 3. Bills in this committee (sorted by score)
      const { data: bs } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, committee_passed, has_public_hearing, stalled, prime_sponsor, prime_party')
        .eq('session', SESSION)
        .eq('committee_name', cmte.name)
        .eq('chamber', cmte.chamber)
        .order('final_score', { ascending: false })
        .limit(100)
      setBills(bs || [])

      // Thread 105 — fetch which of this committee's bills the user tracks
      let watched = new Set()
      if (user && (bs || []).length > 0) {
        const { data: wData } = await supabase
          .from('tracked_bills')
          .select('bill_id')
          .eq('user_id', user.id)
          .in('bill_id', (bs || []).map(b => b.bill_id))
        watched = new Set((wData || []).map(d => d.bill_id))
      }
      setWatchedIds(watched)

      // 4. Committee roster
      const { data: mem } = await supabase
        .from('committee_members')
        .select('member_name, member_id, title, party')
        .eq('committee_id', cmte.id)
        .order('title', { ascending: true })
      setMembers(mem || [])

      setLoading(false)
    }
    load()
  }, [slug, SESSION, user?.id, viewerLoading])

  // Phase 11.2 — follow toggles
  async function handleFollow() {
    if (!user || !committee || followBusy) return
    setFollowBusy(true)
    const { error } = await supabase
      .from('user_followed_committees')
      .upsert(
        { user_id: user.id, committee_id: committee.id, alerts_enabled: true },
        { onConflict: 'user_id,committee_id' },
      )
    if (!error) setFollow({ alerts_enabled: true })
    setFollowBusy(false)
  }

  async function handleUnfollow() {
    if (!user || !committee || followBusy) return
    setFollowBusy(true)
    const { error } = await supabase
      .from('user_followed_committees')
      .delete()
      .eq('user_id', user.id)
      .eq('committee_id', committee.id)
    if (!error) setFollow(null)
    setFollowBusy(false)
  }

  async function handleToggleAlerts() {
    if (!user || !committee || !follow || followBusy) return
    setFollowBusy(true)
    const next = !follow.alerts_enabled
    const { error } = await supabase
      .from('user_followed_committees')
      .update({ alerts_enabled: next })
      .eq('user_id', user.id)
      .eq('committee_id', committee.id)
    if (!error) setFollow({ ...follow, alerts_enabled: next })
    setFollowBusy(false)
  }

  if (notFound) {
    return (
      <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
        {isAnonPublic && <PublicNav />}
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 16, color: 'var(--text-muted)', marginBottom: 12 }}>Committee not found.</div>
          <button onClick={() => router.push('/committees')} style={{
            padding: '8px 16px', fontSize: 12, background: 'var(--teal)', color: 'var(--bg)',
            border: 'none', borderRadius: 8, cursor: 'pointer',
          }}>Back to Committees</button>
        </div>
        {!viewerLoading && !isAnonPublic && <Nav />}
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
      {/* Phase 12 Batch 6 — PublicNav for anon when flag is on */}
      {isAnonPublic && <PublicNav />}
      {/* HEADER */}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 16px 14px' : '52px 16px 14px',
        position: 'sticky', top: isAnonPublic ? 60 : 0, zIndex: 40,
      }}>
        <button onClick={() => router.push('/committees')} style={{
          background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 11,
          cursor: 'pointer', padding: 0, marginBottom: 6, fontFamily: 'var(--font-mono)',
        }}>← All committees</button>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
          color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)',
          lineHeight: 1.2,
        }}>
          {committee?.name || '…'}
        </div>
        {committee && (
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {committee.chamber} {committee.is_rules ? '· Rules / Floor Queue' : ''}
          </div>
        )}

        {/* Phase 11.2 — Follow / alerts toggle (capability-gated in Batch 6) */}
        {committee && user && capabilities?.canFollow && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!follow ? (
              <button
                onClick={handleFollow}
                disabled={followBusy}
                style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 600,
                  background: 'var(--teal)', color: 'var(--bg)', border: 'none',
                  borderRadius: 6, cursor: followBusy ? 'wait' : 'pointer',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                + Follow Committee
              </button>
            ) : (
              <>
                <button
                  onClick={handleUnfollow}
                  disabled={followBusy}
                  style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 600,
                    background: 'transparent', color: 'var(--teal)',
                    border: '1px solid var(--teal)', borderRadius: 6,
                    cursor: followBusy ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Check size={11} aria-hidden="true" strokeWidth={3} /> Following
                  </span>
                </button>
                <button
                  onClick={handleToggleAlerts}
                  disabled={followBusy}
                  title={follow.alerts_enabled
                    ? 'Alerts on — you will be emailed when new meetings are scheduled'
                    : 'Alerts off — committee appears in your follows but no emails'}
                  style={{
                    padding: '6px 10px', fontSize: 10,
                    background: follow.alerts_enabled ? 'rgba(184,151,90,0.15)' : 'var(--bg-card)',
                    color: follow.alerts_enabled ? 'var(--gold)' : 'var(--text-faint)',
                    border: '1px solid ' + (follow.alerts_enabled ? 'rgba(184,151,90,0.4)' : 'var(--border)'),
                    borderRadius: 6, cursor: followBusy ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Bell size={11} aria-hidden="true" /> Alerts: {follow.alerts_enabled ? 'On' : 'Off'}
                  </span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <VectorLoader label="Loading committee" />
      ) : (
        <>

          {/* SECTION 1 — UPCOMING MEETINGS */}
          <Section title="Upcoming Meetings" subtitle={`${meetings.length} scheduled`} primary>
            {meetings.length === 0 ? (
              <EmptyCard>
                No scheduled meetings yet. Committee agendas typically post 5–7 days ahead during session, day-of during interim.
              </EmptyCard>
            ) : (
              meetings.map(m => (
                <div key={m.id} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 6,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <div style={{ minWidth: 72 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                      {fmtDay(m.meeting_date)}
                    </div>
                    {m.meeting_time && (
                      <div style={{ fontSize: 11, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>
                        {fmtTime(m.meeting_time)}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                      {m.meeting_type && (
                        <span style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 8,
                          color: 'var(--text-muted)', border: '1px solid var(--border)',
                          fontFamily: 'var(--font-mono)',
                        }}>{m.meeting_type}</span>
                      )}
                      {m.is_joint && (
                        <span style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 600,
                          color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.3)',
                        }}>JOINT</span>
                      )}
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {(m.meeting_agenda_items || []).filter(a => a.bill_id).length} bills
                      </span>
                    </div>
                    {m.location && (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{m.location}</div>
                    )}
                    {m.agenda_url && (
                      <a href={m.agenda_url} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: 10, color: 'var(--teal)', textDecoration: 'underline',
                        fontFamily: 'var(--font-mono)',
                      }}>View agenda →</a>
                    )}
                  </div>
                </div>
              ))
            )}
          </Section>

          {/* SECTION 2 — BILLS IN THIS COMMITTEE */}
          {(() => {
            const remainingBills = bills.filter(b => !watchedIds.has(b.bill_id))
            const myBills = bills.filter(b => watchedIds.has(b.bill_id))
            const subtitle = watchedIds.size > 0
              ? `${watchedIds.size} of yours · ${bills.length} bills · click to open`
              : `${bills.length} bills · click to open`
            return (
              <Section title="Bills in Committee" subtitle={subtitle}>
                {bills.length === 0 ? (
                  <EmptyCard>No bills are currently in this committee. Activity will appear once bills get referred or scheduled here.</EmptyCard>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {/* Thread 105 — YOUR TRACKED BILLS pinned section */}
                    {myBills.length > 0 && (
                      <>
                        <div style={{
                          fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                          color: 'var(--teal)', letterSpacing: '0.08em', textTransform: 'uppercase',
                          marginBottom: 2,
                        }}>YOUR TRACKED BILLS</div>
                        {myBills.map(b => (
                          <Link key={b.bill_id} href={'/bill/' + b.bill_id} prefetch={false} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            borderLeft: '3px solid var(--teal)',
                            textDecoration: 'none', color: 'inherit',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(184,151,90,0.06)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}>
                            <ScoreBadge score={b.final_score} size="sm" />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500 }}>
                                  {b.chamber === 'House' ? 'HB' : 'SB'} {b.bill_number}
                                </span>
                                {b.committee_passed && (
                                  <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                    <Check size={9} aria-hidden="true" strokeWidth={3} /> CMTE PASS
                                  </span>
                                )}
                                {b.stalled && (
                                  <span style={{ fontSize: 9, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>STALLED</span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {b.title || 'Bill ' + b.bill_number}
                              </div>
                            </div>
                          </Link>
                        ))}
                        {remainingBills.length > 0 && (
                          <div style={{ height: 6 }} />
                        )}
                      </>
                    )}

                    {/* Full bill list (deduped) */}
                    {remainingBills.slice(0, 50).map(b => (
                      <Link key={b.bill_id} href={'/bill/' + b.bill_id} prefetch={false} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        textDecoration: 'none', color: 'inherit',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(184,151,90,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}>
                        <ScoreBadge score={b.final_score} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500 }}>
                              {b.chamber === 'House' ? 'HB' : 'SB'} {b.bill_number}
                            </span>
                            {b.committee_passed && (
                              <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Check size={9} aria-hidden="true" strokeWidth={3} /> CMTE PASS
                              </span>
                            )}
                            {b.stalled && (
                              <span style={{ fontSize: 9, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>STALLED</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.title || 'Bill ' + b.bill_number}
                          </div>
                        </div>
                      </Link>
                    ))}
                    {remainingBills.length > 50 && (
                      <div style={{ textAlign: 'center', padding: 8, fontSize: 10, color: 'var(--text-faint)' }}>
                        Showing top 50 of {remainingBills.length}
                      </div>
                    )}
                  </div>
                )}
              </Section>
            )
          })()}

          {/* SECTION 3 — COMMITTEE ROSTER
              Interim note (Thread 1 Sub-task 5): WA Legislature does not
              publish committee member rosters via CommitteeService.asmx during
              interim (verified 2026-04-23: <Members> element absent entirely).
              Previously this rendered a bare "No roster data available" empty
              card that made healthy interim data look broken. */}
          <Section title="Roster" subtitle={members.length > 0 ? `${members.length} members` : ''}>
            {members.length === 0 ? (
              isInterimPeriod() ? (
                (() => {
                  // getNextBiennium() falls back to current when BIENNIUMS hasn't
                  // been extended — guard so we never claim rosters publish on a
                  // start date that's already in the past.
                  const cur = getCurrentBiennium()
                  const nxt = getNextBiennium()
                  const hasRealNext = nxt && cur && nxt.session !== cur.session
                  return (
                    <EmptyCard muted>
                      {hasRealNext
                        ? `Committee rosters publish when the ${nxt.session} session convenes ${formatSessionDate(nxt.start)}. The Washington Legislature does not maintain public roster assignments between sessions.`
                        : `Committee rosters publish when the next legislative session convenes. The Washington Legislature does not maintain public roster assignments between sessions.`}
                    </EmptyCard>
                  )
                })()
              ) : (
                <EmptyCard muted>No roster data available for this committee.</EmptyCard>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Sort: Chair first, then Vice Chair, Ranking, then alphabetical */}
                {[...members].sort((a, b) => {
                  const order = t => {
                    const tl = (t || '').toLowerCase()
                    if (tl.includes('chair') && !tl.includes('vice')) return 0
                    if (tl.includes('vice chair')) return 1
                    if (tl.includes('ranking')) return 2
                    return 3
                  }
                  const d = order(a.title) - order(b.title)
                  return d !== 0 ? d : a.member_name.localeCompare(b.member_name)
                }).map((m, i) => {
                  const isLeadership = (m.title || '').toLowerCase().includes('chair') ||
                    (m.title || '').toLowerCase().includes('ranking')
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 6,
                      background: isLeadership ? 'rgba(184,151,90,0.04)' : 'var(--bg-card)',
                      border: '1px solid ' + (isLeadership ? 'rgba(184,151,90,0.15)' : 'var(--border)'),
                    }}>
                      {/* Party dot */}
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: m.party === 'D' ? 'var(--party-d)' : m.party === 'R' ? 'var(--party-r)' : 'var(--text-faint)',
                      }} title={m.party === 'D' ? 'Democrat' : m.party === 'R' ? 'Republican' : ''} />
                      {/* Name */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{
                          fontSize: 13, color: 'var(--text-primary)', fontWeight: isLeadership ? 600 : 400,
                        }}>{m.member_name}</span>
                      </div>
                      {/* Role badge */}
                      {m.title && m.title !== 'Member' && (
                        <span style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 8, flexShrink: 0,
                          fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.02em',
                          textTransform: 'uppercase',
                          color: (m.title || '').toLowerCase().includes('chair') && !(m.title || '').toLowerCase().includes('vice')
                            ? 'var(--gold)'
                            : 'var(--text-muted)',
                          border: '1px solid ' + (
                            (m.title || '').toLowerCase().includes('chair') && !(m.title || '').toLowerCase().includes('vice')
                              ? 'rgba(184,151,90,0.4)'
                              : 'var(--border)'
                          ),
                        }}>{m.title}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </>
      )}

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}

function Section({ title, subtitle, children, primary }) {
  return (
    <div style={{ padding: '14px 16px 4px' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10,
        paddingBottom: 6, borderBottom: '1px solid var(--border)',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: primary ? 15 : 13, fontWeight: 600,
          color: primary ? 'var(--teal)' : 'var(--gold)', letterSpacing: '0.02em',
        }}>{title}</span>
        {subtitle && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function EmptyCard({ children, muted }) {
  return (
    <div style={{
      padding: '16px', textAlign: 'center',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      fontSize: 12, color: muted ? 'var(--text-faint)' : 'var(--text-muted)', lineHeight: 1.5,
    }}>{children}</div>
  )
}
