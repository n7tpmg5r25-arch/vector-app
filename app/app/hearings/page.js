'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, isInterimPeriod, getNextBiennium, getCurrentBiennium, formatSessionDate } from '../../lib/session-config'
import { exportHearingsCSV } from '../../lib/csv-export'
import { exportSingleHearingICS, exportAllHearingsICS } from '../../lib/ics-export'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const SESSION = typeof window !== 'undefined' ? getCurrentSession() : '2025-2026'

export default function HearingsPage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [hearings, setHearings]     = useState([])
  const [billHearings, setBillHearings] = useState([])
  const [watchedIds, setWatchedIds] = useState(new Set())
  const [loading, setLoading]       = useState(true)
  const [chamber, setChamber]       = useState('All')
  const [view, setView]             = useState('upcoming')
  const isInterim = typeof window !== 'undefined' ? isInterimPeriod() : true

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: wl } = await supabase
          .from('tracked_bills')
          .select('bill_id')
          .eq('user_id', user.id)
        setWatchedIds(new Set((wl || []).map(w => w.bill_id)))
      }

      const { data: hearingRows } = await supabase
        .from('hearings')
        .select(`
          id, committee_name, hearing_date, location, tvw_link, testimony_deadline, session,
          bill_id,
          bills(bill_id, bill_number, title, final_score, chamber, committee_name, stage)
        `)
        .order('hearing_date', { ascending: true })
        .limit(100)

      setHearings((hearingRows || []).filter(h => h.bills))

      const { data: billRows } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, committee_name, hearing_date, has_public_hearing, committee_passed, prime_sponsor, prime_party')
        .eq('session', SESSION)
        .eq('has_public_hearing', true)
        .not('hearing_date', 'is', null)
        .order('final_score', { ascending: false })
        .limit(200)

      setBillHearings(billRows || [])
      setLoading(false)
    }
    load()
  }, [])

  const filteredBillHearings = billHearings.filter(b => {
    if (chamber !== 'All' && b.chamber !== chamber) return false
    return true
  })

  const watchedHearings = filteredBillHearings.filter(b => watchedIds.has(b.bill_id))
  const allHearings = filteredBillHearings
  const displayBills = view === 'watched' ? watchedHearings : allHearings

  function formatDate(dateStr) {
    if (!dateStr) return '\u2014'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return dateStr }
  }

  // 6.16.3: CSV export
  function handleExportCSV() {
    if (displayBills.length > 0) {
      exportHearingsCSV(displayBills, SESSION)
    }
  }

  // 6.16.4: ICS export (single)
  function handleExportICS(bill, e) {
    e.stopPropagation()
    exportSingleHearingICS(bill, SESSION)
  }

  // 6.16.4: ICS export (all)
  function handleExportAllICS() {
    const withDates = displayBills.filter(b => b.hearing_date)
    if (withDates.length > 0) {
      exportAllHearingsICS(withDates, SESSION)
    }
  }

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
      <div style={{
        background: 'rgba(8,12,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(0,229,204,0.2)' }}>
            Hearings
          </div>
          {/* 6.16.3 + 6.16.4: Export buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleExportCSV}
              disabled={displayBills.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: 'rgba(0,229,204,0.08)',
                border: '1px solid rgba(0,229,204,0.25)',
                color: 'var(--teal)', fontSize: 10, fontWeight: 500,
                cursor: displayBills.length === 0 ? 'default' : 'pointer',
                opacity: displayBills.length === 0 ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
              title="Export as CSV"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              CSV
            </button>
            <button
              onClick={handleExportAllICS}
              disabled={displayBills.filter(b => b.hearing_date).length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: 'rgba(212,168,75,0.08)',
                border: '1px solid rgba(212,168,75,0.25)',
                color: 'var(--gold)', fontSize: 10, fontWeight: 500,
                cursor: displayBills.filter(b => b.hearing_date).length === 0 ? 'default' : 'pointer',
                opacity: displayBills.filter(b => b.hearing_date).length === 0 ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
              title="Export all hearings as .ics calendar file"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              .ics
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Committee schedules {'·'} WA Legislature
        </div>

        {isInterim && (() => {
          const next = typeof window !== 'undefined' ? getNextBiennium() : { session: '2027-2028', start: '2027-01-13' }
          const cur = typeof window !== 'undefined' ? getCurrentBiennium() : { session: '2025-2026' }
          return (
            <div style={{
              background: 'var(--gold-pale)', border: '1px solid rgba(212,168,75,0.25)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 12,
              fontSize: 11, color: 'var(--gold)', fontWeight: 500,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ boxShadow: 'var(--gold-glow)', width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', flexShrink: 0 }}/>
                <span>WA Legislature is in interim. Hearings resume when the {next.session} session opens {formatSessionDate(next.start)}.</span>
              </div>
              <div style={{ paddingLeft: 12, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.5 }}>
                {cur.session} bills that didn't pass are dead. The {next.session} biennium begins {formatSessionDate(next.start)}.
              </div>
            </div>
          )
        })()}

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['upcoming', 'watched'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '5px 14px', borderRadius: 16, fontSize: 11, fontWeight: 500,
              background: view === v ? 'var(--teal)' : 'transparent',
              color: view === v ? 'var(--bg)' : 'var(--text-muted)',
              border: `1px solid ${view === v ? 'var(--teal)' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: view === v ? 'var(--teal-glow)' : 'none',
            }}>
              {v === 'upcoming' ? `All (${allHearings.length})` : `Watched (${watchedHearings.length})`}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {['All', 'House', 'Senate'].map(c => (
            <button key={c} onClick={() => setChamber(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: chamber === c ? 'var(--bg-surface)' : 'transparent',
              color: chamber === c ? 'var(--text-primary)' : 'var(--text-muted)',
              border: `1px solid ${chamber === c ? 'var(--border-light)' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {hearings.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Scheduled Hearings
            </div>
            {hearings.map(h => (
              <div
                key={h.id}
                onClick={() => router.push(`/bill/${h.bill_id}`)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 7,
                  cursor: 'pointer', transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ScoreBadge score={h.bills?.final_score} size="sm"/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                      {h.bills?.chamber === 'House' ? 'HB' : 'SB'} {h.bills?.bill_number}
                      {watchedIds.has(h.bill_id) && <span style={{ marginLeft: 6, color: 'var(--gold)' }}>{'\uD83D\uDD16'}</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4 }}>
                      {h.bills?.title || h.bills?.committee_name || `Bill ${h.bills?.bill_number}`}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>
                        {'\uD83D\uDCC5'} {formatDate(h.hearing_date)}
                      </span>
                      {h.committee_name && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.committee_name}</span>
                      )}
                      {h.tvw_link && (
                        <a href={h.tvw_link} target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 10, color: 'var(--teal-mid)', textDecoration: 'underline' }}>
                          TVW {'\u2192'}
                        </a>
                      )}
                      {/* 6.16.4: Add to Calendar button */}
                      {h.hearing_date && h.bills && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            exportSingleHearingICS({
                              ...h.bills,
                              hearing_date: h.hearing_date,
                              location: h.location,
                              committee_name: h.committee_name || h.bills.committee_name,
                            }, SESSION)
                          }}
                          style={{
                            fontSize: 9, color: 'var(--gold)', background: 'rgba(212,168,75,0.1)',
                            border: '1px solid rgba(212,168,75,0.2)', borderRadius: 6,
                            padding: '1px 6px', cursor: 'pointer', fontWeight: 500,
                          }}
                          title="Add to calendar"
                        >
                          + Cal
                        </button>
                      )}
                    </div>
                    {h.testimony_deadline && (
                      <div style={{ fontSize: 10, color: 'var(--gold)', marginTop: 3 }}>
                        Testimony deadline: {formatDate(h.testimony_deadline)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : displayBills.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}>
            <div style={{ fontSize: 28, marginBottom: 12, filter: 'grayscale(0.5)' }}>{'\uD83D\uDCC5'}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--teal)', marginBottom: 8 }}>
              {view === 'watched' ? 'No watched bills had hearings' : 'No hearings found'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {view === 'watched'
                ? 'Add bills to your watchlist to track their hearings here.'
                : `Hearing data will populate when the ${typeof window !== 'undefined' ? getNextBiennium().session : '2027-2028'} session opens.`}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              {SESSION} {'·'} Bills with Hearings ({displayBills.length})
            </div>
            {displayBills.map((bill, idx) => (
              <div
                key={bill.bill_id}
                onClick={() => router.push(`/bill/${bill.bill_id}`)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 6,
                  cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                  transition: 'border-color 0.2s',
                  borderLeft: watchedIds.has(bill.bill_id) ? '3px solid var(--gold)' : '1px solid var(--border)',
                  animation: `fadeUp 0.3s ease ${idx * 0.02}s both`,
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <ScoreBadge score={bill.final_score} size="sm"/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    </span>
                    {watchedIds.has(bill.bill_id) && <span style={{ color: 'var(--gold)', fontSize: 10 }}>{'\uD83D\uDD16'}</span>}
                    {bill.committee_passed && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--teal-pale)', color: 'var(--teal)', border: '1px solid rgba(0,229,204,0.2)', borderRadius: 8, fontWeight: 600 }}>
                        {'\u2713'} Pass
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {bill.hearing_date && (
                      <span style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>
                        {'\uD83D\uDCC5'} {formatDate(bill.hearing_date)}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                      {bill.committee_name || 'No committee assigned'}
                    </span>
                    {/* 6.16.4: Add to Calendar button for each bill */}
                    {bill.hearing_date && (
                      <button
                        onClick={(e) => handleExportICS(bill, e)}
                        style={{
                          fontSize: 9, color: 'var(--gold)', background: 'rgba(212,168,75,0.1)',
                          border: '1px solid rgba(212,168,75,0.2)', borderRadius: 6,
                          padding: '1px 6px', cursor: 'pointer', fontWeight: 500,
                          transition: 'all 0.15s',
                        }}
                        title="Add this hearing to your calendar"
                      >
                        + Cal
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Nav/>
    </div>
  )
}
