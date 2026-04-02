'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import Nav from '../../components/Nav'
import ScoreBadge from '../../components/ScoreBadge'

export default function HearingsPage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [hearings, setHearings]     = useState([])
  const [billHearings, setBillHearings] = useState([])
  const [watchedIds, setWatchedIds] = useState(new Set())
  const [loading, setLoading]       = useState(true)
  const [chamber, setChamber]       = useState('All')
  const [view, setView]             = useState('upcoming') // 'upcoming' | 'watched'
  const isInterim = true // Session ended March 12, 2026

  useEffect(() => {
    async function load() {
      // Get current user's watchlist bill IDs
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: wl } = await supabase
          .from('tracked_bills')
          .select('bill_id')
          .eq('user_id', user.id)
        setWatchedIds(new Set((wl || []).map(w => w.bill_id)))
      }

      // Try hearings table first (will have data once 2027 session starts)
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

      // Fallback: bills with hearing_date from the 2025-26 session
      const { data: billRows } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, committee_name, hearing_date, has_public_hearing, committee_passed, prime_sponsor, prime_party')
        .eq('session', '2025-2026')
        .eq('has_public_hearing', true)
        .not('hearing_date', 'is', null)
        .order('final_score', { ascending: false })
        .limit(200)

      setBillHearings(billRows || [])
      setLoading(false)
    }
    load()
  }, [])

  // Filter bill hearings by chamber
  const filteredBillHearings = billHearings.filter(b => {
    if (chamber !== 'All' && b.chamber !== chamber) return false
    return true
  })

  const watchedHearings = filteredBillHearings.filter(b => watchedIds.has(b.bill_id))
  const allHearings = filteredBillHearings

  const displayBills = view === 'watched' ? watchedHearings : allHearings

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return dateStr }
  }

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--green-dark)', marginBottom: 4 }}>
          Hearings
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Committee schedules · WA Legislature
        </div>

        {/* Interim banner */}
        {isInterim && (
          <div style={{
            background: 'var(--gold-pale)', border: '1px solid var(--gold)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 12,
            fontSize: 11, color: 'var(--gold)', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>●</span>
            <span>WA Legislature is in interim. Hearings resume when the 2027 session opens Jan 13, 2027.</span>
          </div>
        )}

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['upcoming', 'watched'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '5px 14px', borderRadius: 16, fontSize: 11, fontWeight: 500,
              background: view === v ? 'var(--green-dark)' : 'var(--bg)',
              color: view === v ? 'white' : 'var(--text-muted)',
              border: `1px solid ${view === v ? 'var(--green-dark)' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              {v === 'upcoming' ? `All (${allHearings.length})` : `Watched (${watchedHearings.length})`}
            </button>
          ))}
        </div>

        {/* Chamber filter */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {['All', 'House', 'Senate'].map(c => (
            <button key={c} onClick={() => setChamber(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: chamber === c ? 'var(--green-dark)' : 'var(--bg)',
              color: chamber === c ? 'white' : 'var(--text-muted)',
              border: `1px solid ${chamber === c ? 'var(--green-dark)' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Live hearings from hearings table (when in session) */}
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
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ScoreBadge score={h.bills?.final_score} size="sm"/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                      {h.bills?.chamber === 'House' ? 'HB' : 'SB'} {h.bills?.bill_number}
                      {watchedIds.has(h.bill_id) && <span style={{ marginLeft: 6, color: 'var(--gold)' }}>🔖</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4 }}>
                      {h.bills?.title || h.bills?.committee_name || `Bill ${h.bills?.bill_number}`}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, color: 'var(--green-dark)', fontFamily: 'var(--font-mono)' }}>
                        📅 {formatDate(h.hearing_date)}
                      </span>
                      {h.committee_name && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.committee_name}</span>
                      )}
                      {h.tvw_link && (
                        <a href={h.tvw_link} target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 10, color: 'var(--green-mid)', textDecoration: 'underline' }}>
                          TVW →
                        </a>
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

        {/* 2025-26 Session hearing history */}
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : displayBills.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📅</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--green-dark)', marginBottom: 8 }}>
              {view === 'watched' ? 'No watched bills had hearings' : 'No hearings found'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {view === 'watched'
                ? 'Add bills to your watchlist to track their hearings here.'
                : 'Hearing data will populate when the 2027 session opens.'}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              2025-26 Session · Bills with Hearings ({displayBills.length})
            </div>
            {displayBills.map(bill => (
              <div
                key={bill.bill_id}
                onClick={() => router.push(`/bill/${bill.bill_id}`)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 6,
                  cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                  transition: 'box-shadow 0.15s',
                  borderLeft: watchedIds.has(bill.bill_id) ? '3px solid var(--gold)' : '1px solid var(--border)',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <ScoreBadge score={bill.final_score} size="sm"/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    </span>
                    {watchedIds.has(bill.bill_id) && <span style={{ color: 'var(--gold)', fontSize: 10 }}>🔖</span>}
                    {bill.committee_passed && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--green-pale)', color: 'var(--green-dark)', border: '1px solid var(--green-light)', borderRadius: 8, fontWeight: 600 }}>
                        ✓ Pass
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {bill.hearing_date && (
                      <span style={{ fontSize: 10, a�lor: 'var(--green-dark)', fontFamily: 'var(--font-mono)' }}>
                        📅 {formatDate(bill.hearing_date)}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                      {bill.committee_name || '—'}
                    </span>
                    {bill.prime_sponsor && (
                      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                        {bill.prime_sponsor}{bill.prime_party ? ` (${bill.prime_party.charAt(0)})` : ''}
                      </span>
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
